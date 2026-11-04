<# C2: installs only into a new path. No launch, credentials, registry or policy changes.
   The explicit ManifestSha256 must be taken from the package command's output.
   DesktopDirectory exists only to support owned test fixtures or an explicit user-selected Desktop.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ManifestSha256,
  [switch]$CreateDesktopShortcut,
  [string]$DesktopDirectory
)
function ObserveInstallPhase([string]$phase,[string]$edge){
  if($env:ALEPH_PACKAGE_TEST_DIAGNOSTICS -cne '1' -or @('SCRIPT','SETUP','HELPERS','MANIFEST_READ','MANIFEST_VALIDATE','ZIP_READ_HASH','ZIP_TYPE','ZIP_INDEX','DEST_PREFLIGHT','DEST_CLAIM') -cnotcontains $phase -or @('START','END') -cnotcontains $edge){return}
  try{[Console]::Error.WriteLine('ALEPH_INSTALL_PHASE:'+$phase+':'+$edge);[Console]::Error.Flush()}catch{}
}
ObserveInstallPhase 'SCRIPT' 'START'
ObserveInstallPhase 'SETUP' 'START'
Set-StrictMode -Version 3
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
$held=New-Object Collections.Generic.List[IDisposable]
$claimed=$false
$completed=$false
$stage='validate'
$shortcutContext='unknown'
function Reject([string]$code){throw $code}
function HashBytes([byte[]]$bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Exact($value,[string[]]$keys){if($null -eq $value){return $false};$actual=@($value.PSObject.Properties.Name);return $actual.Count -eq $keys.Count -and @($keys|Where-Object{$actual -cnotcontains $_}).Count -eq 0}
function SafeRelative([string]$value){
  if([string]::IsNullOrEmpty($value) -or $value.Length -gt 250 -or $value -match '[\\:\x00-\x1f\x7f-\x9f<>"|?*]' -or $value.StartsWith('/')){return $false}
  foreach($part in $value.Split('/')){if(!$part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)'){return $false}}
  return $true
}
function Absolute([string]$value){
  if($value -notmatch '^[A-Za-z]:\\' -or $value -match '["\x00-\x1f\x7f]' -or $value.Substring(2).Contains(':')){Reject 'INSTALL_PATH_UNSAFE'}
  $full=[IO.Path]::GetFullPath($value)
  if(![string]::Equals($full,$value,[StringComparison]::OrdinalIgnoreCase) -or $full -match '[. ]$'){Reject 'INSTALL_PATH_UNSAFE'}
  return $full
}
# Optional diagnostic metadata only. Never emit paths or COM property values.
function ReadShortcutContext([string]$Staging,[string]$InstallRoot,[object]$Shortcut){
  try{
    $paths=[ordered]@{parent=[IO.Path]::GetDirectoryName($Staging);staging=$Staging;target=(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe');launcher=(Join-Path $InstallRoot 'education\on-client\tools\start-alekov.ps1');working=(Join-Path $InstallRoot 'education\on-client');icon=(Join-Path $InstallRoot 'education\on-client\package-assets\app.ico')}
    $context=[ordered]@{parentExists='unknown';targetExists='unknown';launcherExists='unknown';workingExists='unknown';iconExists='unknown';parentLength='unknown';stagingLength='unknown';targetLength='unknown';launcherLength='unknown';workingLength='unknown';iconLength='unknown';apartment='unknown';is64BitProcess='unknown';fullNameMatches='unknown';actualFullNameLength='unknown';NFCeq='unknown';sameParent='unknown';sameFileName='unknown';expectedNonASCII='unknown';actualNonASCII='unknown';replacementPresent='unknown';DefaultCodePage='unknown';defaultRoundtripChanged='unknown';defaultRoundtripMatches='unknown';shortPathMatches='unknown'}
    foreach($name in @('parent','target','launcher','working','icon')){
      try{if($name -ceq 'parent' -or $name -ceq 'working'){$context[$name+'Exists']=[IO.Directory]::Exists($paths[$name])}else{$context[$name+'Exists']=[IO.File]::Exists($paths[$name])}}catch{}
    }
    foreach($name in @('parent','staging','target','launcher','working','icon')){
      try{$length=$paths[$name].Length;if($length -ge 0 -and $length -le 32767){$context[$name+'Length']=$length}}catch{}
    }
    try{$apartment=[Threading.Thread]::CurrentThread.ApartmentState.ToString();if(@('STA','MTA') -ccontains $apartment){$context.apartment=$apartment}}catch{}
    try{$context.is64BitProcess=[Environment]::Is64BitProcess}catch{}
    $roundtripStaging=$null
    try{$context.expectedNonASCII=[regex]::IsMatch($Staging,'[^\x00-\x7f]')}catch{}
    try{$encoding=[Text.Encoding]::Default;$codePage=$encoding.CodePage;if($codePage -gt 0 -and $codePage -le 65535){$context.DefaultCodePage=$codePage};$roundtripStaging=$encoding.GetString($encoding.GetBytes($Staging));$context.defaultRoundtripChanged=![string]::Equals($roundtripStaging,$Staging,[StringComparison]::Ordinal)}catch{}
    try{
      $fullName=$Shortcut.FullName
      if($fullName -is [string] -and $fullName.Length -gt 0 -and $fullName.Length -le 32767){
        $context.actualFullNameLength=$fullName.Length
        $context.fullNameMatches=[string]::Equals($fullName,$Staging,[StringComparison]::OrdinalIgnoreCase)
        try{$context.NFCeq=[string]::Equals($fullName.Normalize([Text.NormalizationForm]::FormC),$Staging.Normalize([Text.NormalizationForm]::FormC),[StringComparison]::OrdinalIgnoreCase)}catch{}
        try{$actualSeparator=$fullName.LastIndexOfAny([char[]]@('\','/'));$expectedSeparator=$Staging.LastIndexOfAny([char[]]@('\','/'));if($actualSeparator -ge 0 -and $expectedSeparator -ge 0){$context.sameParent=[string]::Equals($fullName.Substring(0,$actualSeparator),$Staging.Substring(0,$expectedSeparator),[StringComparison]::OrdinalIgnoreCase);$context.sameFileName=[string]::Equals($fullName.Substring($actualSeparator+1),$Staging.Substring($expectedSeparator+1),[StringComparison]::OrdinalIgnoreCase)}}catch{}
        $context.actualNonASCII=[regex]::IsMatch($fullName,'[^\x00-\x7f]')
        $context.replacementPresent=$fullName.IndexOf([char]0xfffd) -ge 0 -or $fullName.Contains('?')
        if($roundtripStaging -is [string]){$context.defaultRoundtripMatches=[string]::Equals($fullName,$roundtripStaging,[StringComparison]::OrdinalIgnoreCase)}
      }
    }catch{}
    # No trusted short-name query is available here; do not start another shell.
    return $context
  }catch{return 'unknown'}
}
ObserveInstallPhase 'SETUP' 'END'
try{
  if($PSBoundParameters.ContainsKey('DesktopDirectory') -and !$CreateDesktopShortcut){Reject 'INSTALL_SHORTCUT_NOT_REQUESTED'}
  ObserveInstallPhase 'HELPERS' 'START'
  Add-Type -TypeDefinition @'
// BEGIN ALEKOV_PACKAGE_NATIVE_HELPERS
using System;using System.IO;using System.Text;using System.ComponentModel;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;
public static class AlekovPackagePaths {
 [StructLayout(LayoutKind.Sequential)]struct INFO {public uint attr;public System.Runtime.InteropServices.ComTypes.FILETIME c,a,w;public uint vol,hi,lo,links,indexHi,indexLo;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle h,out INFO i);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder p,uint n,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateDirectory(string p,IntPtr security);
 static void Check(SafeFileHandle h,string p,bool directory){INFO i;if(h.IsInvalid||!GetFileInformationByHandle(h,out i)||(i.attr&0x400)!=0||((i.attr&0x10)!=0)!=directory||(!directory&&i.links!=1))throw new IOException("UNSAFE_ENTRY");var b=new StringBuilder(32768);var n=GetFinalPathNameByHandle(h,b,(uint)b.Capacity,0);if(n==0||n>=b.Capacity)throw new IOException("UNSAFE_PATH");var actual=b.ToString();if(actual.StartsWith(@"\\?\"))actual=actual.Substring(4);if(!String.Equals(actual.TrimEnd('\\'),Path.GetFullPath(p).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new IOException("PATH_ALIAS");}
 public static SafeFileHandle Hold(string p){var h=CreateFile(p,0x80,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);try{Check(h,p,true);return h;}catch{h.Dispose();throw;}}
 public static FileStream Read(string p){var h=CreateFile(p,0x80000000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);try{Check(h,p,false);return new FileStream(h,FileAccess.Read);}catch{h.Dispose();throw;}}
 public static void NewDirectory(string p){if(!CreateDirectory(p,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());}
 public static FileStream NewFile(string p){var s=new FileStream(p,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None);try{Check(s.SafeFileHandle,p,false);return s;}catch{s.Dispose();throw;}}
 // Reserve with CREATE_NEW and a real read handle: metadata-only handles do not
 // enforce Windows deletion sharing. COM may write, but cannot replace this file.
 public static SafeFileHandle NewShortcutFile(string p){var h=CreateFile(p,0x80000000,3,IntPtr.Zero,1,0x00200000,IntPtr.Zero);try{Check(h,p,false);return h;}catch{h.Dispose();throw;}}
}
[ComImport,Guid("00021401-0000-0000-C000-000000000046")]class AlekovShellLink {}
[ComImport,Guid("000214F9-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface AlekovShellLinkW {
 [PreserveSig]int GetPath([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder p,int n,IntPtr data,uint flags);
 [PreserveSig]int GetIDList(out IntPtr p);[PreserveSig]int SetIDList(IntPtr p);
 [PreserveSig]int GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder p,int n);
 [PreserveSig]int SetDescription([MarshalAs(UnmanagedType.LPWStr)]string p);
 [PreserveSig]int GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder p,int n);
 [PreserveSig]int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)]string p);
 [PreserveSig]int GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder p,int n);
 [PreserveSig]int SetArguments([MarshalAs(UnmanagedType.LPWStr)]string p);
 [PreserveSig]int GetHotkey(out short p);[PreserveSig]int SetHotkey(short p);
 [PreserveSig]int GetShowCmd(out int p);[PreserveSig]int SetShowCmd(int p);
 [PreserveSig]int GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder p,int n,out int index);
 [PreserveSig]int SetIconLocation([MarshalAs(UnmanagedType.LPWStr)]string p,int index);
 [PreserveSig]int SetRelativePath([MarshalAs(UnmanagedType.LPWStr)]string p,uint reserved);
 [PreserveSig]int Resolve(IntPtr window,uint flags);
 [PreserveSig]int SetPath([MarshalAs(UnmanagedType.LPWStr)]string p);
}
[ComImport,Guid("0000010B-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface AlekovPersistFileW {
 [PreserveSig]int GetClassID(out Guid id);[PreserveSig]int IsDirty();
 [PreserveSig]int Load([MarshalAs(UnmanagedType.LPWStr)]string p,uint mode);
 [PreserveSig]int Save([MarshalAs(UnmanagedType.LPWStr)]string p,[MarshalAs(UnmanagedType.Bool)]bool remember);
 [PreserveSig]int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)]string p);
 [PreserveSig]int GetCurFile(out IntPtr p);
}
public sealed class AlekovPackageShortcut:IDisposable {
 object instance;AlekovShellLinkW link;AlekovPersistFileW file;
 static void Check(int hr){if(hr!=0)throw new COMException("INSTALL_SHORTCUT_COM_FAILED",hr);}
 public AlekovPackageShortcut(){try{instance=new AlekovShellLink();link=(AlekovShellLinkW)instance;file=(AlekovPersistFileW)instance;}catch{Dispose();throw;}}
 public void Initialize(string target,string arguments,string working,string icon,string description){Check(link.SetPath(target));Check(link.SetArguments(arguments));Check(link.SetWorkingDirectory(working));Check(link.SetIconLocation(icon,0));Check(link.SetDescription(description));}
 public void Save(string path){Check(file.Save(path,true));Check(file.SaveCompleted(path));}
 public void Load(string path){Check(file.Load(path,0x20));}
 public string FullName {get{IntPtr p=IntPtr.Zero;try{Check(file.GetCurFile(out p));return Marshal.PtrToStringUni(p);}finally{if(p!=IntPtr.Zero)Marshal.FreeCoTaskMem(p);}}}
 public string TargetPath {get{var b=new StringBuilder(32768);Check(link.GetPath(b,b.Capacity,IntPtr.Zero,4));return b.ToString();}}
 public string Arguments {get{var b=new StringBuilder(32768);Check(link.GetArguments(b,b.Capacity));return b.ToString();}}
 public string WorkingDirectory {get{var b=new StringBuilder(32768);Check(link.GetWorkingDirectory(b,b.Capacity));return b.ToString();}}
 public string IconLocation {get{var b=new StringBuilder(32768);int i;Check(link.GetIconLocation(b,b.Capacity,out i));if(i!=0)throw new IOException("INSTALL_SHORTCUT_UNVERIFIED");return b.ToString();}}
 public string Description {get{var b=new StringBuilder(32768);Check(link.GetDescription(b,b.Capacity));return b.ToString();}}
 public void Dispose(){link=null;file=null;if(instance!=null){object previous=instance;instance=null;Marshal.FinalReleaseComObject(previous);}}
}
// END ALEKOV_PACKAGE_NATIVE_HELPERS
'@
  ObserveInstallPhase 'HELPERS' 'END'
  function HoldChain([string]$value){$d=[IO.DirectoryInfo]::new($value);$chain=New-Object Collections.Generic.List[string];while($null -ne $d){$chain.Add($d.FullName);$d=$d.Parent};for($i=$chain.Count-1;$i -ge 0;$i--){$held.Add([AlekovPackagePaths]::Hold($chain[$i]))}}
  function ReadAll([string]$value,[long]$limit){$stream=[AlekovPackagePaths]::Read($value);$held.Add($stream);if($stream.Length -gt $limit){Reject 'INSTALL_SIZE_LIMIT'};$memory=[IO.MemoryStream]::new();try{$stream.CopyTo($memory);return ,$memory.ToArray()}finally{$memory.Dispose()}}
  ObserveInstallPhase 'MANIFEST_READ' 'START'
  $bundle=Absolute $PSScriptRoot
  HoldChain $bundle
  $manifestBytes=ReadAll (Join-Path $bundle 'APP_PACKAGE_MANIFEST.json') 2097152
  if((HashBytes $manifestBytes) -cne $ManifestSha256.ToLowerInvariant()){Reject 'INSTALL_MANIFEST_HASH_MISMATCH'}
  $manifest=([Text.UTF8Encoding]::new($false,$true)).GetString($manifestBytes)|ConvertFrom-Json
  ObserveInstallPhase 'MANIFEST_READ' 'END'
  ObserveInstallPhase 'MANIFEST_VALIDATE' 'START'
  # v2 = full-app package: the same app archive plus a verified runtime archive (fixed layout under finish-runtime/).
  $fullApp=$manifest.schema -ceq 'alekov.install-package.v2'
  $manifestKeys=@('schema','createdAt','appName','sourceVersion','runtime','archive','installer','icon','source','files','excluded');if($fullApp){$manifestKeys+='fullAppRuntime'}
  if(!(Exact $manifest $manifestKeys) -or ($manifest.schema -cne 'alekov.install-package.v1' -and !$fullApp)){Reject 'INSTALL_MANIFEST_INVALID'}
  if(!(Exact $manifest.archive @('name','bytes','sha256')) -or $manifest.archive.name -cne 'app.zip' -or $manifest.archive.sha256 -notmatch '^[a-f0-9]{64}$' -or $manifest.archive.bytes -gt 73400320 -or $manifest.archive.bytes -lt 22){Reject 'INSTALL_MANIFEST_INVALID'}
  if(!(Exact $manifest.installer @('name','sha256')) -or $manifest.installer.name -cne 'install-app.ps1' -or (HashBytes (ReadAll $PSCommandPath 1048576)) -cne $manifest.installer.sha256){Reject 'INSTALL_TOOL_CHANGED'}
  $supportPath='api/_defense-race-model-copy.mjs';$supportSha='6f4a1e29610a626b80859310a977b06a8f66c5275063626c014ed5a4f4b4f7c2'
  # v1: the app archive carries learning/isolated-runner and the fixed support file and starts with tools/start-alekov.ps1.
  # v2: those provided parts come only from the approved runtime archive; the start is the approved normal-app host entry.
  if($fullApp){if(!(Exact $manifest.runtime @('node','start','learningIncluded','autoLaunch','support')) -or $manifest.runtime.start -cne 'host/start-installed-normal-app.ps1' -or $manifest.runtime.learningIncluded -ne $true -or $manifest.runtime.autoLaunch -ne $false -or $null -ne $manifest.runtime.support){Reject 'INSTALL_RUNTIME_INVALID'}}
  elseif(!(Exact $manifest.runtime @('node','start','learningIncluded','autoLaunch','support')) -or $manifest.runtime.start -cne 'education/on-client/tools/start-alekov.ps1' -or $manifest.runtime.learningIncluded -ne $true -or $manifest.runtime.autoLaunch -ne $false -or !(Exact $manifest.runtime.support @('path','sha256')) -or $manifest.runtime.support.path -cne $supportPath -or $manifest.runtime.support.sha256 -cne $supportSha){Reject 'INSTALL_RUNTIME_INVALID'}
  if($manifest.appName -isnot [string] -or !(SafeRelative $manifest.appName) -or $manifest.appName.Contains('/') -or $manifest.appName.Length -gt 64){Reject 'INSTALL_APP_NAME_INVALID'}
  $expected=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
  $normalized=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$total=0
  if($manifest.files -isnot [Array] -or $manifest.files.Count -lt 1 -or $manifest.files.Count -gt 2002){Reject 'INSTALL_MANIFEST_INVALID'}
  foreach($file in $manifest.files){
    if(!(Exact $file @('path','bytes','sha256','origin')) -or !(SafeRelative $file.path) -or (!$file.path.StartsWith('education/on-client/',[StringComparison]::Ordinal) -and ($fullApp -or $file.path -cne $supportPath)) -or $file.bytes -isnot [ValueType] -or $file.bytes -lt 0 -or $file.bytes -gt 10485760 -or $file.sha256 -notmatch '^[a-f0-9]{64}$' -or @('student','provided','provided-modified','student-added','package') -cnotcontains $file.origin){Reject 'INSTALL_MANIFEST_INVALID'}
    if(!$normalized.Add($file.path.Normalize([Text.NormalizationForm]::FormC))){Reject 'INSTALL_PATH_COLLISION'}
    $expected.Add($file.path,$file);$total+=$file.bytes
  }
  if($total -gt 67108864 -or !$expected.ContainsKey('education/on-client/src/server.mjs') -or !$expected.ContainsKey('education/on-client/student/extension.mjs') -or !$expected.ContainsKey('education/on-client/tools/start-alekov.ps1') -or !$expected.ContainsKey('education/on-client/tools/prepare-native-host.ps1') -or !$expected.ContainsKey('education/on-client/package-assets/app.ico') -or (!$fullApp -and (@($expected.Keys|Where-Object{$_.StartsWith('education/on-client/src/learning/')} ).Count -eq 0 -or @($expected.Keys|Where-Object{$_.StartsWith('education/on-client/tools/isolated-runner/')} ).Count -eq 0))){Reject 'INSTALL_RUNTIME_INCOMPLETE'}
  if(!$fullApp -and (!$expected.ContainsKey($supportPath) -or $expected[$supportPath].sha256 -cne $supportSha -or $expected[$supportPath].origin -cne 'provided')){Reject 'INSTALL_RUNTIME_INCOMPLETE'}
  # Snapshot is bound to the actual app file list; generated icon and the fixed
  # external support have their own hashes. Git provenance remains a C3 claim.
  $provenance=$manifest.source
  if(!(Exact $provenance @('schema','snapshot','git','checkoutEquivalence','submission')) -or $provenance.schema -cne 'alekov.package-source.v1' -or !(Exact $provenance.snapshot @('sha256','files','bytes')) -or !(Exact $provenance.git @('state','head','objectFormat','scope','headTreeSha256','statusSha256','dirty','filesMatchHead')) -or !(Exact $provenance.submission @('state','verified','requiresC3')) -or $provenance.submission.verified -cne $false -or $provenance.submission.requiresC3 -cne $true){Reject 'INSTALL_SOURCE_INVALID'}
  $sourceRows=[Collections.Generic.SortedDictionary[string,object]]::new([StringComparer]::Ordinal)
  foreach($file in $manifest.files){if($file.path.StartsWith('education/on-client/',[StringComparison]::Ordinal) -and $file.path -cne 'education/on-client/package-assets/app.ico'){$sourceRows.Add($file.path.Substring(20),$file)}}
  $sourceLines=New-Object Collections.Generic.List[string];[long]$sourceBytes=0
  foreach($row in $sourceRows.GetEnumerator()){$sourceLines.Add($row.Key+[char]0+[string]$row.Value.bytes+[char]0+$row.Value.sha256);$sourceBytes+=$row.Value.bytes}
  $sourceDigest=HashBytes ([Text.Encoding]::UTF8.GetBytes([string]::Join("`n",$sourceLines)))
  if($provenance.snapshot.sha256 -cne $sourceDigest -or $provenance.snapshot.files -ne $sourceRows.Count -or $provenance.snapshot.bytes -ne $sourceBytes){Reject 'INSTALL_SOURCE_SNAPSHOT_MISMATCH'}
  if($provenance.git.state -ceq 'unavailable'){
    if($null -ne $provenance.checkoutEquivalence -or $provenance.submission.state -cne 'blocked-no-git' -or @('head','objectFormat','scope','headTreeSha256','statusSha256','dirty','filesMatchHead'|Where-Object{$null -ne $provenance.git.$_}).Count -ne 0){Reject 'INSTALL_SOURCE_INVALID'}
  }elseif($provenance.git.state -ceq 'available'){
    $headPattern=if($provenance.git.objectFormat -ceq 'sha1'){'^[a-f0-9]{40}$'}elseif($provenance.git.objectFormat -ceq 'sha256'){'^[a-f0-9]{64}$'}else{Reject 'INSTALL_SOURCE_INVALID'}
    if($provenance.git.head -cnotmatch $headPattern -or $provenance.git.headTreeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $provenance.git.statusSha256 -cnotmatch '^[a-f0-9]{64}$' -or $provenance.git.dirty -isnot [bool] -or $provenance.git.filesMatchHead -isnot [bool] -or ($provenance.git.scope -cne '.' -and !(SafeRelative $provenance.git.scope))){Reject 'INSTALL_SOURCE_INVALID'}
    $equivalence=$provenance.checkoutEquivalence
    if(!(Exact $equivalence @('state','verified','convertedFiles','totalFiles')) -or $equivalence.verified -isnot [bool] -or ($equivalence.convertedFiles -isnot [int] -and $equivalence.convertedFiles -isnot [long]) -or ($equivalence.totalFiles -isnot [int] -and $equivalence.totalFiles -isnot [long]) -or $equivalence.totalFiles -ne $sourceRows.Count -or $equivalence.convertedFiles -lt 0 -or $equivalence.convertedFiles -gt $equivalence.totalFiles){Reject 'INSTALL_SOURCE_INVALID'}
    if($equivalence.state -ceq 'raw-match'){
      if($equivalence.verified -cne $true -or $equivalence.convertedFiles -ne 0 -or $provenance.git.filesMatchHead -cne $true){Reject 'INSTALL_SOURCE_INVALID'}
    }elseif($equivalence.state -ceq 'verified-eol'){
      if($equivalence.verified -cne $true -or $equivalence.convertedFiles -lt 1 -or $provenance.git.filesMatchHead -cne $false -or $provenance.git.dirty -cne $false){Reject 'INSTALL_SOURCE_INVALID'}
    }elseif($equivalence.state -ceq 'unverified'){
      if($equivalence.verified -cne $false -or $equivalence.convertedFiles -ne 0 -or $provenance.git.filesMatchHead -cne $false){Reject 'INSTALL_SOURCE_INVALID'}
    }else{Reject 'INSTALL_SOURCE_INVALID'}
    $contentEquivalent=$provenance.git.filesMatchHead -or $equivalence.state -ceq 'verified-eol'
    $submissionState=if(!$provenance.git.dirty -and $contentEquivalent){'unverified'}else{'blocked-uncommitted'}
    if($provenance.submission.state -cne $submissionState){Reject 'INSTALL_SOURCE_INVALID'}
  }else{Reject 'INSTALL_SOURCE_INVALID'}
  ObserveInstallPhase 'MANIFEST_VALIDATE' 'END'
  ObserveInstallPhase 'ZIP_READ_HASH' 'START'
  $zipBytes=ReadAll (Join-Path $bundle 'app.zip') 73400320
  if($zipBytes.Length -ne $manifest.archive.bytes -or (HashBytes $zipBytes) -cne $manifest.archive.sha256){Reject 'INSTALL_ARCHIVE_HASH_MISMATCH'}
  ObserveInstallPhase 'ZIP_READ_HASH' 'END'
  ObserveInstallPhase 'ZIP_TYPE' 'START'
  Add-Type -AssemblyName System.IO.Compression
  ObserveInstallPhase 'ZIP_TYPE' 'END'
  ObserveInstallPhase 'ZIP_INDEX' 'START'
  $memory=[IO.MemoryStream]::new($zipBytes,$false);$held.Add($memory)
  $zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$false);$held.Add($zip)
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($entry in $zip.Entries){
    $unixType=($entry.ExternalAttributes -shr 16) -band 0xf000
    if(!(SafeRelative $entry.FullName) -or !$seen.Add($entry.FullName) -or !$expected.ContainsKey($entry.FullName) -or $entry.Length -ne $expected[$entry.FullName].bytes -or @($null,0,0x8000) -notcontains $unixType -or ($entry.ExternalAttributes -band 0x400) -ne 0){Reject 'INSTALL_ARCHIVE_ENTRY_INVALID'}
  }
  if($seen.Count -ne $expected.Count){Reject 'INSTALL_ARCHIVE_MISSING_FILE'}
  ObserveInstallPhase 'ZIP_INDEX' 'END'
  $runtimeExpected=$null;$runtimeZip=$null
  if($fullApp){
    $fa=$manifest.fullAppRuntime;$hex='^[a-f0-9]{64}$'
    if(!(Exact $fa @('schema','archive','bundleManifestSha256','nodeSha256','nodeVersion','appRecordSha256','appReleaseSha256','files')) -or $fa.schema -cne 'aleph.alekov.package-full-app-runtime.v2' -or !(Exact $fa.archive @('name','bytes','sha256')) -or $fa.archive.name -cne 'runtime.zip' -or $fa.archive.sha256 -cnotmatch $hex -or $fa.archive.bytes -gt 209715200 -or $fa.archive.bytes -lt 22 -or $fa.bundleManifestSha256 -cnotmatch $hex -or $fa.nodeSha256 -cnotmatch $hex -or $fa.appRecordSha256 -cnotmatch $hex -or $fa.appReleaseSha256 -cnotmatch $hex -or $fa.nodeVersion -cnotmatch '^v(22|24)\.\d+\.\d+$' -or $fa.files -isnot [Array] -or $fa.files.Count -lt 3 -or $fa.files.Count -gt 256){Reject 'INSTALL_FULL_APP_RUNTIME_INVALID'}
    $runtimeExpected=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($file in $fa.files){
      $max=if($file.path -ceq 'finish-runtime/bundle/bin/node.exe'){157286400}else{2097152}
      if(!(Exact $file @('path','bytes','sha256')) -or !(SafeRelative $file.path) -or !$file.path.StartsWith('finish-runtime/',[StringComparison]::Ordinal) -or $file.bytes -isnot [ValueType] -or $file.bytes -lt 1 -or $file.bytes -gt $max -or $file.sha256 -cnotmatch $hex -or $runtimeExpected.ContainsKey($file.path) -or $expected.ContainsKey($file.path)){Reject 'INSTALL_FULL_APP_RUNTIME_INVALID'}
      $runtimeExpected.Add($file.path,$file)
    }
    foreach($pair in @(@('finish-runtime/bundle/finish-runtime-manifest.json',$fa.bundleManifestSha256),@('finish-runtime/bundle/bin/node.exe',$fa.nodeSha256),@('finish-runtime/app.json',$fa.appRecordSha256),@('finish-runtime/app-release.json',$fa.appReleaseSha256))){if(!$runtimeExpected.ContainsKey($pair[0]) -or $runtimeExpected[$pair[0]].sha256 -cne $pair[1]){Reject 'INSTALL_FULL_APP_RUNTIME_INVALID'}}
    $runtimeBytes=ReadAll (Join-Path $bundle 'runtime.zip') 209715200
    if($runtimeBytes.Length -ne $fa.archive.bytes -or (HashBytes $runtimeBytes) -cne $fa.archive.sha256){Reject 'INSTALL_FULL_APP_RUNTIME_HASH_MISMATCH'}
    $runtimeMemory=[IO.MemoryStream]::new($runtimeBytes,$false);$held.Add($runtimeMemory)
    $runtimeZip=[IO.Compression.ZipArchive]::new($runtimeMemory,[IO.Compression.ZipArchiveMode]::Read,$false);$held.Add($runtimeZip)
    $runtimeSeen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $runtimeZip.Entries){
      $unixType=($entry.ExternalAttributes -shr 16) -band 0xf000
      if(!(SafeRelative $entry.FullName) -or !$runtimeSeen.Add($entry.FullName) -or !$runtimeExpected.ContainsKey($entry.FullName) -or $entry.Length -ne $runtimeExpected[$entry.FullName].bytes -or @($null,0,0x8000) -notcontains $unixType -or ($entry.ExternalAttributes -band 0x400) -ne 0){Reject 'INSTALL_FULL_APP_RUNTIME_ENTRY_INVALID'}
    }
    if($runtimeSeen.Count -ne $runtimeExpected.Count){Reject 'INSTALL_FULL_APP_RUNTIME_MISSING_FILE'}
  }
  ObserveInstallPhase 'DEST_PREFLIGHT' 'START'
  $target=Absolute $Destination
  $parent=Split-Path -Parent $target
  HoldChain $parent
  if($target.StartsWith($bundle+'\',[StringComparison]::OrdinalIgnoreCase) -or $bundle.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase) -or [string]::Equals($target,$bundle,[StringComparison]::OrdinalIgnoreCase)){Reject 'INSTALL_OUTPUT_OVERLAP'}
  $shortcutPath=$null
  if($CreateDesktopShortcut){
    $desktop=if($PSBoundParameters.ContainsKey('DesktopDirectory')){Absolute $DesktopDirectory}else{Absolute ([Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory))}
    HoldChain $desktop
    $shortcutPath=Join-Path $desktop ($manifest.appName+'.lnk')
    if(Test-Path -LiteralPath $shortcutPath){Reject 'INSTALL_SHORTCUT_EXISTS'}
    # v2: the shortcut runs the separately installed, approved normal-app host entry at its one fixed location (token
    # user profile). Its existence is required here; its authority is its own compiled policy, never this installer.
    if($fullApp){$normalHost=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) '.aleph-alekov-host\start-installed-normal-app.ps1';if(!(Test-Path -LiteralPath $normalHost -PathType Leaf)){Reject 'INSTALL_NORMAL_APP_HOST_MISSING'}}
  }
  $stage='claim-destination'
  ObserveInstallPhase 'DEST_PREFLIGHT' 'END'
  ObserveInstallPhase 'DEST_CLAIM' 'START'
  [AlekovPackagePaths]::NewDirectory($target);$claimed=$true;$held.Add([AlekovPackagePaths]::Hold($target))
  ObserveInstallPhase 'DEST_CLAIM' 'END'
  $stage='extract-files'
  $directories=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase);[void]$directories.Add($target)
  function ExtractVerified($archive,$rows){
    foreach($entry in $archive.Entries){
      $filename=Join-Path $target ($entry.FullName.Replace('/','\'))
      $relativeParent=($entry.FullName.Substring(0,$entry.FullName.LastIndexOf('/'))).Split('/')
      $current=$target
      foreach($part in $relativeParent){$current=Join-Path $current $part;if($directories.Add($current)){[AlekovPackagePaths]::NewDirectory($current);$held.Add([AlekovPackagePaths]::Hold($current))}}
      $source=$entry.Open();$destinationFile=[AlekovPackagePaths]::NewFile($filename)
      try{
        $buffer=New-Object byte[] 65536;[long]$written=0
        while(($n=$source.Read($buffer,0,$buffer.Length)) -gt 0){$written+=$n;if($written -gt $rows[$entry.FullName].bytes){Reject 'INSTALL_ENTRY_SIZE_CHANGED'};$destinationFile.Write($buffer,0,$n)}
        $destinationFile.Flush($true);$destinationFile.Position=0;$hash=[Security.Cryptography.SHA256]::Create()
        try{$actual=([BitConverter]::ToString($hash.ComputeHash($destinationFile))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
        if($written -ne $rows[$entry.FullName].bytes -or $actual -cne $rows[$entry.FullName].sha256){Reject 'INSTALL_ENTRY_HASH_MISMATCH'}
      }finally{$source.Dispose();$destinationFile.Dispose()}
    }
  }
  ExtractVerified $zip $expected
  if($fullApp){$stage='extract-runtime';ExtractVerified $runtimeZip $runtimeExpected;$work=Join-Path $target 'finish-runtime\work';[AlekovPackagePaths]::NewDirectory($work);$held.Add([AlekovPackagePaths]::Hold($work))}
  if($CreateDesktopShortcut){
    $stage='create-shortcut'
    # COM writes only inside the newly claimed install root. The Desktop copy
    # uses CreateNew, so a competing or existing Desktop file is never overwritten.
    $stagingShortcut=Join-Path $target 'APP_START.lnk'
    $stage='shortcut-com-create'
    $link=$null;$check=$null
    try{
      $link=[AlekovPackageShortcut]::new()
      $stage='shortcut-initialize'
      $shortcutTarget=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $shortcutArguments=if($fullApp){'-NoProfile -ExecutionPolicy Bypass -File "'+$normalHost+'" -InstallRoot "'+$target+'"'}else{'-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $target 'education\on-client\tools\start-alekov.ps1')+'"'}
      $shortcutWorking=Join-Path $target 'education\on-client'
      $shortcutIcon=Join-Path $target 'education\on-client\package-assets\app.ico'
      $link.Initialize($shortcutTarget,$shortcutArguments,$shortcutWorking,$shortcutIcon,$manifest.appName)
      try{$shortcutContext=ReadShortcutContext $stagingShortcut $target $link}catch{$shortcutContext='unknown'}
      $stage='shortcut-save'
      $held.Add([AlekovPackagePaths]::NewShortcutFile($stagingShortcut))
      $link.Save($stagingShortcut)
      # Hold a non-writable/non-replaceable read handle before verification, so
      # the bytes published below are exactly the file checked by the W API.
      $stage='shortcut-read'
      $shortcutBytes=ReadAll $stagingShortcut 1048576
      $stage='shortcut-reopen'
      $check=[AlekovPackageShortcut]::new();$check.Load($stagingShortcut)
      if($check.FullName -cne $stagingShortcut -or $check.TargetPath -cne $shortcutTarget -or $check.Arguments -cne $shortcutArguments -or $check.WorkingDirectory -cne $shortcutWorking -or $check.IconLocation -cne $shortcutIcon -or $check.Description -cne $manifest.appName){Reject 'INSTALL_SHORTCUT_UNVERIFIED'}
      $stage='shortcut-publish'
      $desktopFile=[AlekovPackagePaths]::NewFile($shortcutPath)
      try{$desktopFile.Write($shortcutBytes,0,$shortcutBytes.Length);$desktopFile.Flush($true)}finally{$desktopFile.Dispose()}
    }finally{if($null -ne $check){$check.Dispose()};if($null -ne $link){$link.Dispose()}}
  }
  $stage='write-receipt'
  $receipt=[ordered]@{schema=$(if($fullApp){'alekov.app-install-receipt.v2'}else{'alekov.app-install-receipt.v1'});message='설치를 마쳤습니다. 앱은 바로가기나 기존 실행 도구로 직접 실행하세요.';completed=$true;manifestSha256=$ManifestSha256.ToLowerInvariant();files=$expected.Count;desktopShortcutCreated=[bool]$CreateDesktopShortcut;appLaunched=$false;privateConfigurationCopied=$false}
  # Installation record only (never launch authority or mode): the approved host entry verifies the signed release itself.
  if($fullApp){$receipt['fullApp']=[ordered]@{runtimeArchiveSha256=$fa.archive.sha256;bundleManifestSha256=$fa.bundleManifestSha256;nodeSha256=$fa.nodeSha256;nodeVersion=$fa.nodeVersion;appRecordSha256=$fa.appRecordSha256;appReleaseSha256=$fa.appReleaseSha256;runtimeFiles=$runtimeExpected.Count}}
  $receiptBytes=[Text.Encoding]::UTF8.GetBytes(($receipt|ConvertTo-Json -Compress)+"`n")
  $receiptFile=[AlekovPackagePaths]::NewFile((Join-Path $target 'INSTALL_RECEIPT.json'));try{$receiptFile.Write($receiptBytes,0,$receiptBytes.Length);$receiptFile.Flush($true)}finally{$receiptFile.Dispose()}
  $completed=$true
  ObserveInstallPhase 'SCRIPT' 'END'
  $receipt|ConvertTo-Json -Compress
}catch{
  $reason=$_.Exception.Message;if($reason -notmatch '^[A-Z_]+$'){$reason='INSTALL_FAILED'}
  # Fixed diagnostic metadata only: never print exception text, paths or file content.
  $baseError=$_.Exception.GetBaseException();$exceptionKind=$baseError.GetType().Name
  if($exceptionKind -notmatch '^[A-Za-z][A-Za-z0-9]{0,79}$'){$exceptionKind='Exception'}
  $diagnostic=[ordered]@{stage=$stage;exceptionKind=$exceptionKind;hresult=$baseError.HResult.ToString('X8')}
  if($stage -ceq 'shortcut-save'){try{$diagnostic.Add('shortcutContext',$shortcutContext)}catch{}}
  [Console]::Error.WriteLine((@{ok=$false;message='설치를 마치지 못했습니다. 기존 프로젝트는 덮어쓰지 않았습니다. 새 부분 결과가 있다면 그대로 두고 INSTALL.md를 확인하세요.';code=$reason;diagnostic=$diagnostic;outputClaimed=$claimed;partialOutputPreserved=$claimed;completed=$false}|ConvertTo-Json -Compress))
  exit 1
}finally{
  for($i=$held.Count-1;$i -ge 0;$i--){try{$held[$i].Dispose()}catch{}}
}
