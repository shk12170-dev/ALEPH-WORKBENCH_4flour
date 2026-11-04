// Package-only guards. The original portable exporter remains unchanged.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EXCLUDED_DIRECTORIES,LIMITS,planExport,normalizeAppName} from './export-student-package.mjs';

export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const RUNTIME_SUPPORT=Object.freeze({path:'api/_defense-race-model-copy.mjs',sha256:'6f4a1e29610a626b80859310a977b06a8f66c5275063626c014ed5a4f4b4f7c2'});
export async function readRuntimeSupport(){const file=fileURLToPath(new URL('../../../'+RUNTIME_SUPPORT.path,import.meta.url)),read=await stableRead(file);if(sha(read.bytes)!==RUNTIME_SUPPORT.sha256)fail('PACKAGE_SUPPORT_CHANGED');checkContent(read.bytes);return {file,...read};}
export const fail=code=>{throw Object.assign(Error(code),{code});};
export const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String).join(':');
const proof=s=>[identity(s),s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
export const safePath=value=>typeof value==='string'&&value.length>0&&value.length<=240&&!/[\\:\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/u.test(value)&&!value.startsWith('/')
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!/[<>"|?*]/.test(part)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
export const inside=(child,parent)=>{const r=path.relative(parent,child);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export async function guards(directory){
  const chain=[];for(let p=directory;;p=path.dirname(p)){const st=await fs.lstat(p,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||!same(await fs.realpath(p),p))fail('PACKAGE_PATH_UNSAFE');chain.push({path:p,identity:identity(st)});if(path.dirname(p)===p)break;}return chain;
}
export async function checkGuards(chain){for(const entry of chain){const st=await fs.lstat(entry.path,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||identity(st)!==entry.identity||!same(await fs.realpath(entry.path),entry.path))fail('PACKAGE_PATH_CHANGED');}}
export async function stableRead(filename,max=LIMITS.fileBytes){
  const chain=await guards(path.dirname(filename)),named=await fs.lstat(filename,{bigint:true});
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1n||named.size>BigInt(max))fail('PACKAGE_FILE_UNSAFE');
  const fd=await fs.open(filename,'r');try{const opened=await fd.stat({bigint:true});if(proof(opened)!==proof(named))fail('PACKAGE_SOURCE_CHANGED');
    const bytes=await fd.readFile();const after=await fd.stat({bigint:true}),last=await fs.lstat(filename,{bigint:true});await checkGuards(chain);
    if(bytes.length>max||proof(opened)!==proof(after)||proof(opened)!==proof(last)||last.isSymbolicLink())fail('PACKAGE_SOURCE_CHANGED');return {bytes,proof:proof(opened)};
  }finally{await fd.close();}
}
export const excludedName=name=>/^\.env(?:\.|$)/i.test(name)&&name.toLowerCase()!=='.env.example'
  ||/\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|der|db|sqlite|sqlite3|db-wal|db-shm|log|jsonl|dpapi)$/i.test(name)||/-(?:wal|shm|journal)$/i.test(name)
  ||/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(name)||/^(?:\.npmrc|\.netrc|\.git-credentials|\.pypirc)$/i.test(name)
  ||/^(?:native|sdp|personal|private|app-config|action-config)\.(?:json|ya?ml|ini|conf)$/i.test(name)
  ||/(?:token|session|credential|password|secret|private[-_]?config|personal[-_]?config|native[-_]?host|sdp[-_]?host|registry|vault).*\.(?:json|txt|dat|bin|ini|cfg|conf|ya?ml|xml|enc|store)$/i.test(name);
const secrets=[/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,/\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-|ant-|on-)?[A-Za-z0-9_-]{32,}/,/\bxox[abprs]-[A-Za-z0-9-]{10,}/,/\b(?:sbp_|sb_secret_)[A-Za-z0-9_-]{30,}/,
  /Bearer[ \t]+[A-Za-z0-9._-]{20,}/i,/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  /(?:^|[\r\n{,])[ \t]*["']?(?:access_token|refresh_token|id_token|client_secret|api[_-]?key|password|passwd|private_key|ON_AI_APP_KEY|OPENAI_API_KEY)["']?[ \t]*[:=][ \t]*["'][^"'\s]{8,}["']/im];
export function checkContent(bytes){
  const texts=[bytes.toString('utf8')];if(bytes[0]===0xff&&bytes[1]===0xfe)texts.push(bytes.toString('utf16le'));
  if(texts.some(text=>secrets.some(rule=>rule.test(text))))fail('PACKAGE_SECRET_CONTENT');
  try{const value=JSON.parse(texts[0]);if(['keshev.personal-config.v1','alekov.native-host-config.v1','alekov.sdp.host.v1'].includes(value?.schema)
    ||value&&typeof value==='object'&&['vaultRoot','registryRoot','tokenFile','keyFile','protected'].some(key=>Object.hasOwn(value,key)))fail('PACKAGE_PRIVATE_CONFIGURATION');}catch(error){if(error.code)throw error;}
}
export function appName(input){const value=normalizeAppName(input);if(!safePath(value)||value.includes('/')||value==='.'||value==='..')fail('PACKAGE_APP_NAME_INVALID');return value;}

// providedRuntime:true (v2 full app): learning and the isolated runner are provided only by the approved runtime archive,
// so they are neither walked nor required here; v1 keeps its original inclusion rules.
export async function planApp(sourceInput,{providedRuntime=false}={}){
  if(typeof providedRuntime!=='boolean')fail('PACKAGE_ARGUMENT_INVALID');
  // Reuse the existing exporter's validation of source identity, dependencies,
  // original path/link/secret rules and provided/student origin classification.
  const base=await planExport(sourceInput),files=[],excluded={directories:providedRuntime?[...base.excludedDirectories]:base.excludedDirectories.filter(p=>!['src/learning','tools/isolated-runner'].includes(p)),secretFiles:[...base.secretFiles]};
  for(const row of base.files){if(excludedName(path.posix.basename(row.path))){excluded.secretFiles.push(row.path);continue;}files.push(row);}
  async function walk(rel){
    const abs=path.join(base.source,...rel.split('/')),st=await fs.lstat(abs);
    if(st.isSymbolicLink()||!st.isDirectory()&&(!st.isFile()||st.nlink!==1))fail('PACKAGE_LINK_REFUSED');
    if(!safePath(rel))fail('PACKAGE_PATH_UNSAFE');
    if(st.isDirectory()){
      if(EXCLUDED_DIRECTORIES.includes(path.posix.basename(rel).toLowerCase())){excluded.directories.push(rel);return;}
      for(const entry of (await fs.readdir(abs)).sort())await walk(rel+'/'+entry);return;
    }
    if(excludedName(path.posix.basename(rel))){excluded.secretFiles.push(rel);return;}
    const read=await stableRead(abs);try{checkContent(read.bytes);}catch(error){error.path=rel;throw error;}const digest=sha(read.bytes);
    const provided=base.starterHashes?.[rel];files.push({path:rel,bytes:read.bytes.length,sha256:digest,abs,proof:read.proof,origin:provided?(provided===digest?'provided':'provided-modified'):'student-added'});
  }
  if(!providedRuntime)for(const rel of ['src/learning','tools/isolated-runner']){try{await walk(rel);}catch(error){if(error.code==='ENOENT')fail('PACKAGE_RUNTIME_INCOMPLETE');throw error;}}
  const seen=new Set();let bytes=0;
  for(const row of files){const key=row.path.normalize('NFC').toLowerCase();if(!safePath(row.path)||seen.has(key))fail('PACKAGE_PATH_COLLISION');seen.add(key);bytes+=row.bytes;}
  if(files.length>LIMITS.files||bytes>LIMITS.totalBytes)fail('PACKAGE_LIMIT_EXCEEDED');
  for(const required of ['src/server.mjs','student/extension.mjs','tools/start-alekov.ps1','tools/prepare-native-host.ps1'])if(!seen.has(required))fail('PACKAGE_RUNTIME_INCOMPLETE');
  if(!providedRuntime&&(!files.some(row=>row.path.startsWith('src/learning/'))||!files.some(row=>row.path.startsWith('tools/isolated-runner/'))))fail('PACKAGE_RUNTIME_INCOMPLETE');
  return {...base,files:files.sort((a,b)=>a.path<b.path?-1:1),excluded,totalBytes:bytes,providedRuntime};
}

const execute=promisify(execFile);
export function sourceSnapshot(files){
  const ordered=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {sha256:sha(Buffer.from(ordered.map(row=>`${row.path}\0${row.bytes}\0${row.sha256}`).join('\n'),'utf8')),files:ordered.length,bytes:ordered.reduce((sum,row)=>sum+row.bytes,0)};
}
// Only local Git reads: no hooks, fsmonitor executable, index refresh writes,
// replacement objects or lazy network object fetch. Absolute source paths stay private.
export async function sourceProvenance(plan,gitPath='git'){
  const snapshot=sourceSnapshot(plan.files),unavailable={state:'unavailable',head:null,objectFormat:null,scope:null,headTreeSha256:null,statusSha256:null,dirty:null,filesMatchHead:null};
  const environment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('GIT_'))),filterOverrides=[];
  const git=async (args,cwd=plan.source)=>(await execute(gitPath,['--no-optional-locks','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...filterOverrides,'-C',cwd,...args],
    {windowsHide:true,encoding:'buffer',timeout:15000,maxBuffer:8*1024*1024,env:{...environment,LC_ALL:'C',GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'}})).stdout;
  let top;
  try{top=(await git(['rev-parse','--show-toplevel'])).toString('utf8').trim();}catch(error){
    if(error.code!=='ENOENT'&&!error.stderr?.toString().includes('not a git repository'))fail('PACKAGE_GIT_UNVERIFIABLE');
    return {schema:'alekov.package-source.v1',snapshot,git:unavailable,checkoutEquivalence:null,submission:{state:'blocked-no-git',verified:false,requiresC3:true}};
  }
  const relative=path.relative(top,plan.source).split(path.sep).join('/'),scope=relative||'.';
  if(!inside(plan.source,path.resolve(top))||relative&&!safePath(relative))fail('PACKAGE_GIT_UNVERIFIABLE');
  // Even status can execute repository-configured clean/process filters. Disable
  // all configured filters by command arguments before asking for status.
  try{const keys=(await git(['config','--null','--name-only','--get-regexp','^filter\\..*\\.(clean|process|required)$'])).toString().split('\0').filter(Boolean);
    for(const key of keys)filterOverrides.push('-c',key+'='+(key.endsWith('.required')?'false':''));
  }catch(error){if(error.code!==1)fail('PACKAGE_GIT_UNVERIFIABLE');}
  let head,objectFormat,tree,status;
  try{head=(await git(['rev-parse','--verify','HEAD^{commit}'])).toString().trim();objectFormat=(await git(['rev-parse','--show-object-format'])).toString().trim();
    tree=await git(['ls-tree','-r','-z','--full-tree','HEAD','--',scope],top);status=await git(['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=all','--',scope],top);
  }catch{fail('PACKAGE_GIT_UNVERIFIABLE');}
  if(!['sha1','sha256'].includes(objectFormat)||!new RegExp(`^[a-f0-9]{${objectFormat==='sha1'?40:64}}$`).test(head))fail('PACKAGE_GIT_UNVERIFIABLE');
  const tracked=new Map();for(const entry of tree.toString('utf8').split('\0').filter(Boolean)){const match=/^(\d+) blob ([a-f0-9]+)\t(.*)$/s.exec(entry);if(match)tracked.set(match[3],{mode:match[1],oid:match[2]});}
  let filesMatchHead=true;const rawMismatch=[];
  for(const row of plan.files){const read=await stableRead(row.abs);if(read.proof!==row.proof||sha(read.bytes)!==row.sha256)fail('PACKAGE_SOURCE_CHANGED');
    const original=tracked.get(relative?relative+'/'+row.path:row.path),oid=createHash(objectFormat).update(Buffer.from(`blob ${read.bytes.length}\0`)).update(read.bytes).digest('hex');
    if(!original||!['100644','100755'].includes(original.mode)||original.oid!==oid){filesMatchHead=false;rawMismatch.push({row,original,bytes:read.bytes});}
  }
  // Keep the raw-byte comparison above authoritative. A clean Windows checkout
  // may differ only because core.autocrlf converted tracked text from LF to CRLF.
  // Prove that narrowly from local config, effective attributes and blob bytes;
  // never invoke clean/smudge filters or rewrite the source snapshot.
  let checkoutEquivalence={state:filesMatchHead?'raw-match':'unverified',verified:filesMatchHead,convertedFiles:0,totalFiles:plan.files.length};
  if(!filesMatchHead&&!status.length&&rawMismatch.length){
    try{
      const autocrlf=(await git(['config','--type=bool','--get','core.autocrlf'])).toString('utf8').trim();
      if(autocrlf==='true'){
        let convertedFiles=0,eligible=true;
        for(const {row,original,bytes} of rawMismatch){
          if(!original||!['100644','100755'].includes(original.mode)||bytes.includes(0)||!bytes.includes(13)||/\r(?!\n)/u.test(bytes.toString('latin1'))){eligible=false;break;}
          const fullPath=relative?relative+'/'+row.path:row.path;
          const attrBytes=await git(['check-attr','-z','text','eol','filter','working-tree-encoding','ident','--',fullPath],top),parts=attrBytes.toString('utf8').split('\0');
          const attrNames=['text','eol','filter','working-tree-encoding','ident'];
          if(parts.length!==attrNames.length*3+1||parts.at(-1)!==''){eligible=false;break;}
          const attrs=new Map();for(let i=0;i<parts.length-1;i+=3){if(parts[i]!==fullPath||attrs.has(parts[i+1])||!attrNames.includes(parts[i+1])){eligible=false;break;}attrs.set(parts[i+1],parts[i+2]);}
          if(!eligible||attrs.size!==attrNames.length||!['unspecified','set','auto'].includes(attrs.get('text'))||!['unspecified','crlf'].includes(attrs.get('eol'))
            ||attrs.get('filter')!=='unspecified'||attrs.get('working-tree-encoding')!=='unspecified'||attrs.get('ident')!=='unspecified'){eligible=false;break;}
          const blob=(await git(['cat-file','blob',original.oid],top));
          if(blob.includes(0)||blob.includes(13)||!blob.includes(10)){eligible=false;break;}
          const normalized=Buffer.from(bytes.toString('latin1').replace(/\r\n/g,'\n'),'latin1');
          if(!normalized.equals(blob)){eligible=false;break;}convertedFiles++;
        }
        if(eligible&&convertedFiles===rawMismatch.length)checkoutEquivalence={state:'verified-eol',verified:true,convertedFiles,totalFiles:plan.files.length};
      }
    }catch{ /* Any missing or ambiguous proof stays unverified. */ }
  }
  // HEAD may move between reads even when working bytes do not change.
  if((await git(['rev-parse','--verify','HEAD^{commit}'])).toString().trim()!==head)fail('PACKAGE_SOURCE_CHANGED');
  const metadata={state:'available',head,objectFormat,scope,headTreeSha256:sha(tree),statusSha256:sha(status),dirty:status.length>0,filesMatchHead};
  const contentEquivalent=filesMatchHead||checkoutEquivalence.state==='verified-eol';
  return {schema:'alekov.package-source.v1',snapshot,git:metadata,checkoutEquivalence,submission:{state:!metadata.dirty&&contentEquivalent?'unverified':'blocked-uncommitted',verified:false,requiresC3:true}};
}

const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export function pngIcon(bytes){
  if(bytes.length<57||bytes.length>1024*1024||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))fail('PACKAGE_ICON_INVALID');
  let offset=8,first=true,end=false,idat=false,channels=0;const imageData=[];
  while(offset<bytes.length){if(offset+12>bytes.length)fail('PACKAGE_ICON_INVALID');const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),next=offset+12+size;
    if(next>bytes.length||crc32(bytes.subarray(offset+4,next-4))!==bytes.readUInt32BE(next-4))fail('PACKAGE_ICON_INVALID');
    if(first){if(type!=='IHDR'||size!==13||bytes.readUInt32BE(offset+8)!==256||bytes.readUInt32BE(offset+12)!==256||bytes[offset+16]!==8||![2,6].includes(bytes[offset+17])||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)fail('PACKAGE_ICON_INVALID');channels=bytes[offset+17]===6?4:3;first=false;}
    else if(type==='IHDR')fail('PACKAGE_ICON_INVALID');
    if(type==='IDAT'){idat=true;imageData.push(bytes.subarray(offset+8,next-4));}if(type==='IEND'){if(size!==0||next!==bytes.length||!idat)fail('PACKAGE_ICON_INVALID');end=true;}
    offset=next;
  }
  if(!end)fail('PACKAGE_ICON_INVALID');
  try{const stride=256*channels+1,decoded=inflateSync(Buffer.concat(imageData),{maxOutputLength:stride*256});if(decoded.length!==stride*256)fail('PACKAGE_ICON_INVALID');for(let row=0;row<256;row++)if(decoded[row*stride]>4)fail('PACKAGE_ICON_INVALID');}catch{fail('PACKAGE_ICON_INVALID');}
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(bytes.length,14);header.writeUInt32LE(22,18);
  return Buffer.concat([header,bytes]); // Pixel bytes are unchanged; no raster generation/resizing.
}
export function makeZip(entries){
  const local=[],central=[];let offset=0;
  for(const entry of entries){const name=Buffer.from(entry.path,'utf8'),bytes=entry.data,crc=crc32(bytes),head=Buffer.alloc(30),tail=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(name.length,26);
    tail.writeUInt32LE(0x02014b50);tail.writeUInt16LE(0x314,4);tail.writeUInt16LE(20,6);tail.writeUInt16LE(0x800,8);tail.writeUInt16LE(33,14);tail.writeUInt32LE(crc,16);tail.writeUInt32LE(bytes.length,20);tail.writeUInt32LE(bytes.length,24);tail.writeUInt16LE(name.length,28);tail.writeUInt32LE(0x81a40000,38);tail.writeUInt32LE(offset,42);
    local.push(head,name,bytes);central.push(tail,name);offset+=head.length+name.length+bytes.length;
  }
  const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,centralBytes,end]);
}
