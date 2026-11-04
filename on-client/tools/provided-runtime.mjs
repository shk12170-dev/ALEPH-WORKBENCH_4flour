// Provided full-app runtime archive (runtime.zip) and its purpose-separated signed catalog entry. Self-contained (node:*
// only) so the student starter, the host C3 catalog and the collector read the SAME actual bytes with the SAME rules.
// The archive is the immutable operator-approved artifact: copied byte-for-byte, never rebuilt or re-zipped.
// verify*(): bounded streaming inventory of the stored ZIP, consistency with the bundle manifest inside it, the exact v2
// package section derived from those bytes, and (when the caller passes approved roots) the Ed25519 catalog signature.
// Without roots this is an integrity check only and never authority.
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
export const PROVIDED_RUNTIME_LIMITS=Object.freeze({archive:200*1024*1024,node:150*1024*1024,file:2*1024*1024,rows:256,catalog:65536});
export const PROVIDED_RUNTIME_CATALOG_DOMAIN='ALEPH_ALEKOV_PROVIDED_RUNTIME_CATALOG_V1';
const SECTION='aleph.alekov.package-full-app-runtime.v2',ENVELOPE='aleph.alekov.provided-runtime-catalog-envelope.v1',PAYLOAD='aleph.alekov.provided-runtime-catalog.v1',PURPOSE='installed-app-provided-runtime';
const NODE='finish-runtime/bundle/bin/node.exe',MANIFEST='finish-runtime/bundle/finish-runtime-manifest.json',RECORD='finish-runtime/app.json',RELEASE='finish-runtime/app-release.json',READ=512*1024;
const fail=code=>{throw Object.assign(Error(code),{code});};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sha=b=>createHash('sha256').update(b).digest('hex'),keys=(v,k)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
export function canonicalJson(value){const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;return JSON.stringify(sort(value));}
const digest=v=>sha(Buffer.from(canonicalJson(v),'utf8'));
const safe=p=>typeof p==='string'&&p.length<=240&&p===p.normalize('NFC')&&!/[\\:\u0000-\u001f\u007f-\u009f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&!/[<>"|?*]/.test(s));
function strictJson(bytes,code){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(code);}let v;try{v=JSON.parse(text);}catch{fail(code);}return v;}
// The one fixed host location of the approved provided-runtime cache (token user profile). Never student-chosen.
export function providedRuntimeHostDirectory(){const profile=os.userInfo().homedir;if(typeof profile!=='string'||!path.isAbsolute(profile))fail('PROVIDED_RUNTIME_HOST_UNAVAILABLE');return path.join(profile,'.aleph-alekov-host','runtime');}
const identity=s=>[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
async function plainFile(file,max){const s=await fs.lstat(file,{bigint:true}).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));if(!s)return null;if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size<22n||s.size>BigInt(max)||path.resolve(await fs.realpath(file)).toLowerCase()!==path.resolve(file).toLowerCase())fail('PROVIDED_RUNTIME_PATH_UNSAFE');return s;}
async function readAt(handle,offset,length){const b=Buffer.alloc(length);let done=0;while(done<length){const {bytesRead}=await handle.read(b,done,length-done,offset+done);if(!bytesRead)fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');done+=bytesRead;}return b;}
async function hashRange(handle,offset,length){const h=createHash('sha256');for(let at=0;at<length;at+=READ)h.update(await readAt(handle,offset+at,Math.min(READ,length-at)));return h.digest('hex');}
// Stored (method 0) ZIP only, exactly as the C2 writer produces: every row's local header, name, sizes and bytes are read.
async function inventory(handle,size){
 const tailLength=Math.min(size,22+65535),tail=await readAt(handle,size-tailLength,tailLength);let eocd=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0||tail.readUInt16LE(eocd+4)||tail.readUInt16LE(eocd+6)||tail.readUInt16LE(eocd+8)!==tail.readUInt16LE(eocd+10)||eocd+22+tail.readUInt16LE(eocd+20)!==tail.length)fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');
 const count=tail.readUInt16LE(eocd+10),cdSize=tail.readUInt32LE(eocd+12),cdOffset=tail.readUInt32LE(eocd+16);if(count<4||count>PROVIDED_RUNTIME_LIMITS.rows||cdOffset+cdSize!==size-tailLength+eocd||cdSize>count*(46+240))fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');
 const cd=await readAt(handle,cdOffset,cdSize),rows=[],seen=new Set();let at=0,expectedLocal=0;
 for(let i=0;i<count;i++){
  if(at+46>cd.length||cd.readUInt32LE(at)!==0x02014b50)fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');const method=cd.readUInt16LE(at+10),csize=cd.readUInt32LE(at+20),usize=cd.readUInt32LE(at+24),nameLength=cd.readUInt16LE(at+28),extra=cd.readUInt16LE(at+30),comment=cd.readUInt16LE(at+32),local=cd.readUInt32LE(at+42),flags=cd.readUInt16LE(at+8);
  const name=cd.subarray(at+46,at+46+nameLength).toString('utf8');at+=46+nameLength+extra+comment;
  if(method!==0||csize!==usize||extra||comment||(flags&~0x800)||!safe(name)||!name.startsWith('finish-runtime/')||seen.has(name.toLowerCase())||local!==expectedLocal||usize<1||usize>(name===NODE?PROVIDED_RUNTIME_LIMITS.node:PROVIDED_RUNTIME_LIMITS.file))fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');seen.add(name.toLowerCase());
  const head=await readAt(handle,local,30);if(head.readUInt32LE(0)!==0x04034b50||head.readUInt16LE(8)!==0||head.readUInt32LE(18)!==usize||head.readUInt32LE(22)!==usize||head.readUInt16LE(26)!==nameLength||head.readUInt16LE(28)!==0||!(await readAt(handle,local+30,nameLength)).equals(Buffer.from(name,'utf8')))fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');
  const data=local+30+nameLength;rows.push({path:name,bytes:usize,offset:data});expectedLocal=data+usize;
 }
 if(at!==cd.length||expectedLocal!==cdOffset)fail('PROVIDED_RUNTIME_ARCHIVE_INVALID');
 for(const r of rows)r.sha256=await hashRange(handle,r.offset,r.bytes);return rows;
}
function catalogPayload(raw){const p=raw;if(!keys(p,['schema','purpose','runtimeId','revision','platform','archive','inventoryDigest','bundleManifestSha256','node','appRecordSha256','appReleaseSha256','runtimePinsDigest','installerSha256','providerBuild'])||p.schema!==PAYLOAD||p.purpose!==PURPOSE||!uuid(p.runtimeId)||!Number.isSafeInteger(p.revision)||p.revision<1||p.platform!=='windows'||!keys(p.archive,['bytes','sha256'])||!Number.isSafeInteger(p.archive.bytes)||!hex(p.archive.sha256)||!keys(p.node,['sha256','bytes','version'])||!hex(p.node.sha256)||!Number.isSafeInteger(p.node.bytes)||!/^v(?:22|24)\.\d+\.\d+$/.test(p.node.version)||!keys(p.providerBuild,['sourceInventoryDigest'])||!hex(p.providerBuild.sourceInventoryDigest)||!['inventoryDigest','bundleManifestSha256','appRecordSha256','appReleaseSha256','runtimePinsDigest','installerSha256'].every(k=>hex(p[k])))fail('PROVIDED_RUNTIME_CATALOG_INVALID');return p;}
export function providedRuntimeCatalogSigningBytes(payloadText){if(typeof payloadText!=='string'||payloadText.length>16384)fail('PROVIDED_RUNTIME_CATALOG_INVALID');const p=catalogPayload(strictJson(Buffer.from(payloadText,'utf8'),'PROVIDED_RUNTIME_CATALOG_INVALID'));if(canonicalJson(p)!==payloadText)fail('PROVIDED_RUNTIME_CATALOG_INVALID');return Buffer.from(PROVIDED_RUNTIME_CATALOG_DOMAIN+'\n'+payloadText,'utf8');}
function catalog(bytes){if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>PROVIDED_RUNTIME_LIMITS.catalog)fail('PROVIDED_RUNTIME_CATALOG_INVALID');const e=strictJson(bytes,'PROVIDED_RUNTIME_CATALOG_INVALID');if(!keys(e,['schema','domain','keyId','payload','signature'])||e.schema!==ENVELOPE||e.domain!==PROVIDED_RUNTIME_CATALOG_DOMAIN||typeof e.keyId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(e.keyId)||typeof e.signature!=='string'||!/^[a-f0-9]{128}$/.test(e.signature))fail('PROVIDED_RUNTIME_CATALOG_INVALID');const signed=providedRuntimeCatalogSigningBytes(e.payload);return {envelope:e,signed,payload:catalogPayload(JSON.parse(e.payload))};}
// The exact v2 package section derived from the actual archive bytes (package-app writes it; C3 compares to it).
function section(rows,size,archiveSha,manifest){
 const by=new Map(rows.map(r=>[r.path,r]));for(const p of [MANIFEST,NODE,RECORD,RELEASE])if(!by.has(p))fail('PROVIDED_RUNTIME_INVENTORY_INVALID');
 if(!keys(manifest,['schema','authority','operatingVerified','layout','node','externalPrerequisites','runtimePins','files'])||manifest.authority!==false||manifest.operatingVerified!==false||!Array.isArray(manifest.files)||!keys(manifest.node,['path','bytes','sha256','version'])||manifest.node.path!=='bin/node.exe'||manifest.node.sha256!==by.get(NODE).sha256||manifest.node.bytes!==by.get(NODE).bytes)fail('PROVIDED_RUNTIME_INVENTORY_INVALID');
 // Complete inventory: exactly the manifest, Node, every manifest row (same bytes) and the two public records.
 const expected=new Set([MANIFEST,NODE,RECORD,RELEASE]);for(const f of manifest.files){const r=by.get('finish-runtime/bundle/'+f.path);if(!r||r.bytes!==f.bytes||r.sha256!==f.sha256)fail('PROVIDED_RUNTIME_INVENTORY_INVALID');expected.add(r.path);}
 if(expected.size!==rows.length)fail('PROVIDED_RUNTIME_INVENTORY_INVALID');
 const files=rows.map(({path,bytes,sha256})=>({path,bytes,sha256}));
 return {schema:SECTION,archive:{name:'runtime.zip',bytes:size,sha256:archiveSha},bundleManifestSha256:by.get(MANIFEST).sha256,nodeSha256:by.get(NODE).sha256,nodeVersion:manifest.node.version,appRecordSha256:by.get(RECORD).sha256,appReleaseSha256:by.get(RELEASE).sha256,files};
}
const ed25519=pem=>{let k;try{k=createPublicKey(pem);}catch{fail('PROVIDED_RUNTIME_CATALOG_CONFIGURATION_INVALID');}if(k.asymmetricKeyType!=='ed25519')fail('PROVIDED_RUNTIME_CATALOG_CONFIGURATION_INVALID');return k;};
// archivePath + catalogBytes → verified view. approvedRoots: null (integrity only) or [{keyId, publicKeyPem, minimumRevision}]
// supplied by host code. The archive is held open while it is read; its identity is re-checked at the end.
export async function verifyProvidedRuntime({archivePath,catalogBytes,approvedRoots=null}){
 if(typeof archivePath!=='string'||!path.isAbsolute(archivePath)||path.resolve(archivePath)!==archivePath)fail('PROVIDED_RUNTIME_PATH_UNSAFE');
 if(approvedRoots!==null&&(!Array.isArray(approvedRoots)||approvedRoots.length>8))fail('PROVIDED_RUNTIME_CATALOG_CONFIGURATION_INVALID');
 const c=catalog(catalogBytes);
 if(approvedRoots!==null){const root=approvedRoots.find(r=>r?.keyId===c.envelope.keyId);if(!root||!Number.isSafeInteger(root.minimumRevision)||c.payload.revision<root.minimumRevision||!verify(null,c.signed,ed25519(root.publicKeyPem),Buffer.from(c.envelope.signature,'hex')))fail('PROVIDED_RUNTIME_UNAPPROVED');}
 const a=await inspectProvidedRuntimeArchive(archivePath),p=c.payload,s=a.section;
 if(p.archive.bytes!==s.archive.bytes||p.archive.sha256!==s.archive.sha256||p.inventoryDigest!==a.inventoryDigest||p.bundleManifestSha256!==s.bundleManifestSha256||p.node.sha256!==s.nodeSha256||p.node.bytes!==a.nodeBytes||p.node.version!==s.nodeVersion||p.appRecordSha256!==s.appRecordSha256||p.appReleaseSha256!==s.appReleaseSha256||p.runtimePinsDigest!==a.runtimePinsDigest||p.installerSha256!==a.installerSha256)fail('PROVIDED_RUNTIME_CATALOG_UNBOUND');
 return Object.freeze({archivePath,identity:a.identity,section:s,catalog:Object.freeze({keyId:c.envelope.keyId,payload:Object.freeze(p),sha256:sha(catalogBytes),signed:approvedRoots!==null}),offsets:a.offsets});
}
// Integrity only (no catalog, never authority): the full bounded inventory of one actual archive, consistency with the
// bundle manifest inside it, and the derived v2 section. Held open while read; identity re-checked at the end.
export async function inspectProvidedRuntimeArchive(archivePath){
 if(typeof archivePath!=='string'||!path.isAbsolute(archivePath)||path.resolve(archivePath)!==archivePath)fail('PROVIDED_RUNTIME_PATH_UNSAFE');
 const named=await plainFile(archivePath,PROVIDED_RUNTIME_LIMITS.archive);if(!named)fail('PROVIDED_RUNTIME_MISSING');
 const handle=await fs.open(archivePath,'r');try{
  const opened=await handle.stat({bigint:true});if(identity(opened)!==identity(named))fail('PROVIDED_RUNTIME_PATH_CHANGED');const size=Number(opened.size);
  const archiveSha=await hashRange(handle,0,size),rows=await inventory(handle,size),manifestRow=rows.find(r=>r.path===MANIFEST);if(!manifestRow)fail('PROVIDED_RUNTIME_INVENTORY_INVALID');
  const manifest=strictJson(await readAt(handle,manifestRow.offset,manifestRow.bytes),'PROVIDED_RUNTIME_INVENTORY_INVALID'),s=section(rows,size,archiveSha,manifest);
  const installer=manifest.files.find(f=>f.path==='runtime/education/on-client/tools/install-packaged-app.ps1');if(!installer||!manifest.runtimePins||typeof manifest.runtimePins!=='object')fail('PROVIDED_RUNTIME_INVENTORY_INVALID');
  const after=await handle.stat({bigint:true}),again=await fs.lstat(archivePath,{bigint:true});if(identity(after)!==identity(opened)||identity(again)!==identity(opened))fail('PROVIDED_RUNTIME_PATH_CHANGED');
  return Object.freeze({identity:identity(opened),section:Object.freeze(s),inventoryDigest:digest(s.files),runtimePinsDigest:digest(manifest.runtimePins),installerSha256:installer.sha256,nodeBytes:rows.find(r=>r.path===NODE).bytes,offsets:Object.freeze(Object.fromEntries(rows.map(r=>[r.path,r.offset])))});
 }finally{await handle.close();}
}
// Student/package side: the single approved runtime in the fixed host cache (<dir>/<archiveSha>/{runtime.zip,catalog.json}).
// Several revisions: the highest wins only if unique. None or ambiguous: truthful not-ready (never a v1 substitute).
export async function resolveHostProvidedRuntime(directory=providedRuntimeHostDirectory()){
 let names;try{names=await fs.readdir(directory);}catch(e){if(e.code==='ENOENT')fail('PROVIDED_RUNTIME_NOT_INSTALLED');throw e;}
 const found=[];for(const name of names.filter(hex).sort()){const dir=path.join(directory,name),s=await fs.lstat(dir);if(!s.isDirectory()||s.isSymbolicLink())fail('PROVIDED_RUNTIME_PATH_UNSAFE');const catalogPath=path.join(dir,'catalog.json'),cs=await plainFile(catalogPath,PROVIDED_RUNTIME_LIMITS.catalog);if(!cs)continue;const v=await verifyProvidedRuntime({archivePath:path.join(dir,'runtime.zip'),catalogBytes:await fs.readFile(catalogPath)});if(v.section.archive.sha256!==name)fail('PROVIDED_RUNTIME_CATALOG_UNBOUND');found.push(v);}
 if(!found.length)fail('PROVIDED_RUNTIME_NOT_INSTALLED');const top=Math.max(...found.map(v=>v.catalog.payload.revision)),best=found.filter(v=>v.catalog.payload.revision===top);if(best.length!==1)fail('PROVIDED_RUNTIME_AMBIGUOUS');return best[0];
}
// Bounded raw read of the verified archive (512 KiB machinery): identity re-checked on every read.
export async function readProvidedRuntimeChunk(view,offset,length=READ){if(!Number.isSafeInteger(offset)||offset<0||offset>=view.section.archive.bytes||!Number.isSafeInteger(length)||length<1||length>READ)fail('PROVIDED_RUNTIME_CHUNK_INVALID');const handle=await fs.open(view.archivePath,'r');try{const s=await handle.stat({bigint:true});if(identity(s)!==view.identity)fail('PROVIDED_RUNTIME_PATH_CHANGED');return await readAt(handle,offset,Math.min(length,view.section.archive.bytes-offset));}finally{await handle.close();}}
export const providedRuntimeInventoryDigest=files=>digest(files);
