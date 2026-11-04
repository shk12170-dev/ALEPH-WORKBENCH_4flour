// Read-only, bounded local Git export. No profile, credentials, network or execution authority.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fail,sha,stableRead,guards,checkGuards,same,inside,safePath,excludedName,checkContent,sourceProvenance} from './package-app-support.mjs';
const execute=promisify(execFile),MiB=1024*1024;
const privateDirs=new Set(['.local','receipts','.credentials','.connections','credentials','vault','registry','native-vault','native-registry','nativevault','nativeregistry','app-vault','app_vault','.vault','.registry','sessions','tokens','logs']);
const oid=(kind,b)=>createHash('sha1').update(Buffer.from(`${kind} ${b.length}\0`)).update(b).digest('hex');
async function exists(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
// Git for Windows installs two hard links to its launcher. This exception is
// only for the installed executable; student/source/output reads retain nlink=1.
async function installedGitRead(file){
  const chain=await guards(path.dirname(file)),named=await fs.lstat(file,{bigint:true});
  const proof=s=>[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
  if(!named.isFile()||named.isSymbolicLink()||named.size>128n*1024n*1024n||!same(await fs.realpath(file),file))fail('PACKAGE_GIT_UNVERIFIABLE');
  const h=await fs.open(file,'r');try{const opened=await h.stat({bigint:true});if(proof(opened)!==proof(named))fail('PACKAGE_SOURCE_CHANGED');const bytes=await h.readFile();await checkGuards(chain);
    if(bytes.length>128*MiB||proof(await h.stat({bigint:true}))!==proof(named)||proof(await fs.lstat(file,{bigint:true}))!==proof(named))fail('PACKAGE_SOURCE_CHANGED');return {bytes,proof:proof(named)};
  }finally{await h.close();}
}
async function repositoryLayout(source){
  // Establish the source repository boundary through filesystem reads before
  // executing anything found in PATH. npm prepends project node_modules/.bin.
  for(let current=path.resolve(source);;current=path.dirname(current)){
    const marker=await exists(path.join(current,'.git'));
    if(marker){
      await guards(current);if(marker.isSymbolicLink()||!marker.isDirectory()&&!marker.isFile())fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
      const files=[];let checkoutGitDir=path.join(current,'.git');
      if(marker.isFile()){
        const read=await stableRead(checkoutGitDir,4096),m=/^gitdir: ([^\r\n\0]+)\r?\n?$/.exec(read.bytes.toString('utf8'));
        if(!m)fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');files.push({path:checkoutGitDir,...read});checkoutGitDir=path.resolve(current,m[1]);
      }
      await guards(checkoutGitDir);let gitDir=checkoutGitDir;
      const common=path.join(checkoutGitDir,'commondir');
      if(await exists(common)){
        const read=await stableRead(common,4096),m=/^([^\r\n\0]+)\r?\n?$/.exec(read.bytes.toString('utf8'));
        if(!m)fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');files.push({path:common,...read});gitDir=path.resolve(checkoutGitDir,m[1]);await guards(gitDir);
      }
      return {root:current,gitDir,checkoutGitDir,files};
    }
    if(path.dirname(current)===current)fail('PACKAGE_GIT_UNVERIFIABLE');
  }
}
async function gitBinary(layout){
  const projectRoots=[layout.root,layout.checkoutGitDir,layout.gitDir,...(path.basename(layout.gitDir).toLowerCase()==='.git'?[path.dirname(layout.gitDir)]:[])];
  // Resolve the ordinary local Git installation once, never a project-supplied executable.
  for(const dir of (process.env.PATH??'').split(path.delimiter)){
    if(!dir||!path.isAbsolute(dir))continue;
    const candidate=path.join(dir,process.platform==='win32'?'git.exe':'git');
    // Skip project-controlled PATH entries even if a symlink resolves outward.
    if(projectRoots.some(root=>inside(candidate,root)))continue;
    try{const actual=await fs.realpath(candidate);if(projectRoots.some(root=>inside(actual,root)))continue;return {path:actual,...await installedGitRead(actual)};}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}
  }
  fail('PACKAGE_GIT_UNVERIFIABLE');
}
export async function createPackageFinishMaterialExporter(plan){
  const layout=await repositoryLayout(plan.source),binary=await gitBinary(layout);
  const provenanceFor=after=>sourceProvenance(after,binary.path),provenance=await provenanceFor(plan);
  return {provenance,provenanceFor,collect:()=>collectPackageFinishMaterials(plan,provenance,{layout,binary})};
}
async function collectPackageFinishMaterials(plan,provenance,{layout,binary}){
  if(provenance.git.state!=='available'||provenance.git.objectFormat!=='sha1'||provenance.git.dirty||!provenance.checkoutEquivalence?.verified)fail('PACKAGE_FINISH_COMMIT_REQUIRED');
  const selected=provenance.git.head,nullDevice=process.platform==='win32'?'NUL':'/dev/null';
  const environment={};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[key]!==undefined)environment[key]=process.env[key];
  Object.assign(environment,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:nullDevice,GIT_CONFIG_GLOBAL:nullDevice,GIT_ATTR_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',LC_ALL:'C',LANG:'C'});
  const git=async(args,maxBuffer=4*MiB,cwd=plan.source)=>{
    try{return (await execute(binary.path,['--no-optional-locks','--no-replace-objects','--literal-pathspecs','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.hooksPath='+nullDevice,'-c','core.attributesFile='+nullDevice,'-c','gc.auto=0','-c','maintenance.auto=false','-c','core.autocrlf=false','-c','tar.umask=0022','-C',cwd,...args],{windowsHide:true,encoding:'buffer',timeout:120000,maxBuffer,env:environment})).stdout;}
    catch{fail('PACKAGE_GIT_UNVERIFIABLE');}
  };
  const root=path.resolve((await git(['rev-parse','--show-toplevel'])).toString('utf8').trim()),{gitDir,checkoutGitDir}=layout;
  if(!same(root,layout.root))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
  const chains=[await guards(root),await guards(checkoutGitDir),await guards(gitDir),await guards(path.join(gitDir,'objects'))];
  const config=await stableRead(path.join(gitDir,'config'),MiB),text=config.bytes.toString('utf8');
  if(/\[\s*(?:include|includeif|filter|extensions|tar)\b/i.test(text)||/(?:^|\n)\s*(?:worktree|alternateRefsCommand|sshCommand|promisor|partialclonefilter)\s*=/i.test(text))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
  async function controls(){
    for(const saved of layout.files){const now=await stableRead(saved.path,4096);if(now.proof!==saved.proof||!now.bytes.equals(saved.bytes))fail('PACKAGE_SOURCE_CHANGED');}
    if(!same(checkoutGitDir,gitDir)&&await exists(path.join(checkoutGitDir,'config.worktree')))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
    for(const name of ['commondir','shallow','config.worktree','info/grafts','info/attributes','objects/info/alternates','objects/info/http-alternates','refs/replace'])if(await exists(path.join(gitDir,...name.split('/'))))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
    const packed=await exists(path.join(gitDir,'packed-refs'));if(packed&&/ refs\/replace\//.test((await stableRead(path.join(gitDir,'packed-refs'),4*MiB)).bytes.toString('utf8')))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
    count=0;await inspect(path.join(gitDir,'objects'));
    if(await exists(path.join(gitDir,'refs'))){await guards(path.join(gitDir,'refs'));await inspect(path.join(gitDir,'refs'));}
  }
  let count=0;
  async function inspect(dir,depth=0){
    if(depth>64)fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
    const entries=await fs.opendir(dir);
    for await(const entry of entries){
      if(++count>100000||entry.name.endsWith('.promisor'))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
      const filename=path.join(dir,entry.name),st=await fs.lstat(filename);
      if(st.isSymbolicLink()||!same(await fs.realpath(filename),filename))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
      if(st.isDirectory())await inspect(filename,depth+1);else if(!st.isFile())fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
    }
  }
  await controls();
  const head=async()=>{if((await git(['rev-parse','--verify','HEAD^{commit}'])).toString().trim()!==selected)fail('PACKAGE_SOURCE_CHANGED');};
  await head();
  const commitObject=await git(['cat-file','commit',selected],MiB);if(oid('commit',commitObject)!==selected)fail('PACKAGE_SOURCE_CHANGED');checkContent(commitObject);
  const tree=await git(['ls-tree','-r','-z','--full-tree',selected],4*MiB),seen=new Set();let total=0,files=0;
  if(tree.length&&tree.at(-1)!==0)fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
  for(const entry of tree.toString('utf8').split('\0').filter(Boolean)){
    const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/su.exec(entry);
    if(!m||!safePath(m[3])||seen.has(m[3].toLowerCase())||++files>2000)fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');seen.add(m[3].toLowerCase());
    const name=m[3],bytes=await git(['cat-file','blob',m[2]],10*MiB);
    if(oid('blob',bytes)!==m[2]||(total+=bytes.length)>120*MiB)fail('PACKAGE_SOURCE_CHANGED');
    const publicExample=name==='education/on-client/tools/portable/personal-config.example.json'&&['939d4a7d1b170229cca246d4de0e905ee82f1224ceace29c7d11cb2e9a8e8551','8a6d6378e37b7baea3bd1ea41eae899b1232b11e5db59ec3357628a6308c9033'].includes(sha(bytes));
    if(!publicExample){if(name.split('/').slice(0,-1).some(p=>privateDirs.has(p.toLowerCase()))||excludedName(path.posix.basename(name)))fail('PACKAGE_PRIVATE_CONFIGURATION');checkContent(bytes);}
    if(path.posix.basename(name)==='.gitattributes'&&/export-(ignore|subst)/.test(bytes.toString('utf8')))fail('PACKAGE_FINISH_GIT_CONTROL_REFUSED');
  }
  // Preserve Git's actual tar bytes. Compression does not reconstruct the tree or files.
  const tar=await git(['archive','--format=tar','--prefix=repo/',selected],120*MiB,root),archiveGz=gzipSync(tar,{level:9,maxOutputLength:25*MiB});
  if(archiveGz.length>25*MiB)fail('PACKAGE_LIMIT_EXCEEDED');
  const assertCurrent=async()=>{
    for(const chain of chains)await checkGuards(chain);
    const now=await stableRead(path.join(gitDir,'config'),MiB),exe=await installedGitRead(binary.path);
    if(now.proof!==config.proof||!now.bytes.equals(config.bytes)||exe.proof!==binary.proof||!exe.bytes.equals(binary.bytes))fail('PACKAGE_SOURCE_CHANGED');
    await controls();
    await head();
  };
  await assertCurrent();
  return {files:[['finish.commit.raw',commitObject],['finish.archive.tar.gz',archiveGz]],assertCurrent};
}
