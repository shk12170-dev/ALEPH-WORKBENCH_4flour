#!/usr/bin/env node
// 수료 후 사용 패키지 내보내기(KESHEV-PORTABLE-20261018-A).
// 학생의 누적 Alekov 프로젝트(on-client 폴더)를 워크벤치·ALEPH 포털 없이 실행할 수 있는 새 폴더로 복사한다.
// - 원본은 읽기만 한다. 출력 폴더는 아직 없는 새 경로만 받고, 원본과 겹치는 위치는 거절한다.
// - 원본 안에 심볼릭 링크·junction 이 하나라도 있으면 전체를 거절한다(링크 너머 파일을 몰래 끌어오지 않는다).
// - .git·node_modules·캐시는 정해진 규칙으로 제외하고, 비밀 파일 이름(.env 등)은 제외한 뒤 경로만 기록한다.
// - 텍스트 내용에서 토큰·개인키 형태가 보이면 학생 코드를 몰래 빼지 않고 내보내기 전체를 거절한다(값은 출력하지 않는다).
// - 파일마다 SHA-256 을 PACKAGE_MANIFEST.json 에 적고, --verify 로 다시 대조한다.
// - 앱 이름은 안내(START_HERE.md)와 목록에만 넣는다. 앱 코드나 화면 제목은 바꾸지 않는다.
import { lstat, readdir, readFile, mkdir, writeFile, rename, realpath, open } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve, relative, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_SCHEMA = 'alekov.portable-package.v1';
export const MANIFEST_NAME = 'PACKAGE_MANIFEST.json';
export const START_NAME = 'START_HERE.md';
export const DEFAULT_APP_NAME = '케셰브';
export const APP_NAME_MAX = 32;
export const LIMITS = Object.freeze({ files: 2000, fileBytes: 10 * 1024 * 1024, totalBytes: 60 * 1024 * 1024 });

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'portable', 'START_HERE.template.md');
const STANDALONE_FILES=Object.freeze(['src/standalone-server.mjs','src/portable/personal-config.mjs','src/portable/personal-model-http.mjs','src/portable/personal-ai.mjs','public/portable/personal.html','public/portable/personal.js','public/portable/personal.css','public/portable/standalone.js','tools/start-standalone.ps1','docs/PERSONAL_AI_SETUP.md']);

// 내용과 관계없이 늘 빼는 폴더(이름이 정확히 같을 때). 의존성·캐시·Git 기록·운영 기록.
export const EXCLUDED_DIRECTORIES = Object.freeze(['.git', 'node_modules', '.local', 'receipts', '.cache', '.npm', '.parcel-cache', '.vercel', 'coverage', '.idea', '.vscode', '.credentials', '.connections', 'credentials', 'vault', 'registry', 'native-vault', 'native-registry', 'nativevault', 'nativeregistry', 'app-vault', 'app_vault', '.vault', '.registry', 'sessions', 'tokens', 'logs', 'test', '__pycache__']);
// 이름만으로 비밀로 보는 파일. .env.example 은 빈 설정 견본이라 포함한다.
const SECRET_FILE_RULES = [
  name => /^\.env$/i.test(name),
  name => /^\.env\./i.test(name) && name.toLowerCase() !== '.env.example',
  name => /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|der)$/i.test(name),
  name => /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i.test(name),
  name => /^(\.npmrc|\.netrc|\.git-credentials|\.pypirc)$/i.test(name),
  name => /\.(?:db|sqlite|sqlite3|db-wal|db-shm|log|jsonl|dpapi)$/i.test(name) || /-(?:wal|shm|journal)$/i.test(name),
  name => /(?:token|session|credential|password|secret|native[-_]?host|sdp[-_]?host|registry|vault).*(?:\.json|\.txt|\.dat|\.bin|\.ini|\.cfg|\.conf|\.ya?ml|\.xml|\.enc|\.store)$/i.test(name)
];
// 텍스트 안에서 보이면 내보내기를 멈추는 형태. 종류 이름만 알리고 값은 어디에도 쓰지 않는다.
const SECRET_CONTENT_RULES = [
  ['GitHub 토큰', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['개인키', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['AWS 접근 키', /\bAKIA[0-9A-Z]{16}\b/],
  ['AI 서비스 키', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}/],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Supabase 토큰', /\bsbp_[A-Za-z0-9]{30,}/],
  ['Bearer 토큰', /Bearer[ \t]+[A-Za-z0-9._-]{20,}/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/],
  ['비밀 설정', /(?:^|[\r\n{,])[ \t]*["']?(?:access_token|refresh_token|id_token|client_secret|api[_-]?key|password|passwd|private_key|ON_AI_APP_KEY|OPENAI_API_KEY)["']?[ \t]*[:=][ \t]*["'][^"'\s]{8,}["']/im]
];
const TEXT_EXT = /\.(m?js|cjs|ts|json|md|txt|html?|css|ps1|cmd|bat|sh|ya?ml|toml|ini|cfg|conf|csv|svg|xml|env|example|gitignore|gitattributes)$/i;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export class ExportError extends Error {
  constructor(code, message, detail = {}) { super(message); this.code = code; this.detail = detail; }
}
const fail = (code, message, detail) => { throw new ExportError(code, message, detail); };
const toPosix = p => p.split(sep).join('/');
const isInside = (child, parent) => { const r = relative(parent, child); return r === '' || (!!r && !r.startsWith('..') && !/^[A-Za-z]:/.test(r) && !r.startsWith(sep)); };
const sameCase = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String).join(':');
const fileProof=s=>[identity(s),s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
async function parents(path){const paths=[];for(let p=path;;p=dirname(p)){paths.push(p);if(dirname(p)===p)break;}const out=[];for(const p of paths.reverse()){const s=await lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||!sameCase(await realpath(p),p))fail('EXPORT_LINK_REFUSED','경로에 링크이거나 실제 폴더가 아닌 항목이 있습니다.');out.push({path:p,identity:identity(s)});}return out;}
async function checkParents(proofs){for(const p of proofs){const s=await lstat(p.path,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||identity(s)!==p.identity||!sameCase(await realpath(p.path),p.path))fail('EXPORT_PARENT_CHANGED','작업 중 상위 폴더가 바뀌었습니다. 결과를 확인한 뒤 다시 진행하세요.');}}
async function stableRead(path,max=LIMITS.fileBytes){
  const chain=await parents(dirname(path)),named=await lstat(path,{bigint:true});
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1n)fail('EXPORT_LINK_REFUSED','링크 또는 일반 파일이 아닌 항목은 내보내지 않습니다.');
  if(named.size>BigInt(max))fail('EXPORT_FILE_TOO_LARGE','허용 크기를 넘은 파일입니다.');
  const fd=await open(path,'r');try{const before=await fd.stat({bigint:true});if(fileProof(before)!==fileProof(named))fail('EXPORT_SOURCE_CHANGED','파일을 여는 중 원본이 바뀌었습니다.');const bytes=await fd.readFile();const after=await fd.stat({bigint:true}),last=await lstat(path,{bigint:true});await checkParents(chain);if(bytes.length>max||fileProof(before)!==fileProof(after)||last.isSymbolicLink()||fileProof(before)!==fileProof(last))fail('EXPORT_SOURCE_CHANGED','읽는 중 원본이 바뀌었습니다.');return {bytes,proof:fileProof(before)};}finally{await fd.close();}
}
const safePath=p=>typeof p==='string'&&p.length>0&&p.length<=512&&!/[\\:\u0000-\u001f\u007f]/.test(p)&&!p.startsWith('/')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!/[. ]$/.test(s)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));

export function normalizeAppName(value) {
  if (value === undefined || value === null) return DEFAULT_APP_NAME;
  const name = String(value).normalize('NFC').trim();
  if (!name) return DEFAULT_APP_NAME;
  if ([...name].length > APP_NAME_MAX) fail('EXPORT_APP_NAME_INVALID', `앱 이름은 ${APP_NAME_MAX}자 이하로 적어 주세요.`);
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff<>`\\]/.test(name)) fail('EXPORT_APP_NAME_INVALID', '앱 이름에 쓸 수 없는 글자가 있습니다.');
  return name;
}

function looksText(rel, bytes) {
  if (TEXT_EXT.test(rel) || /(^|\/)(README|LICENSE|AGENTS)$/i.test(rel)) return true;
  const head = bytes.subarray(0, 8192);
  return bytes.length <= 2 * 1024 * 1024 && !head.includes(0);
}

async function assertAlekovSource(source) {
  await parents(source);
  let info;
  try { info = await lstat(source); } catch { fail('EXPORT_SOURCE_MISSING', '원본 폴더를 찾지 못했습니다. 학생 프로젝트의 on-client 폴더 경로를 확인해 주세요.'); }
  if (info.isSymbolicLink()) fail('EXPORT_LINK_REFUSED', '원본 경로가 바로가기(링크)입니다. 실제 폴더 경로로 다시 실행해 주세요.', { path: '.' });
  if (!info.isDirectory()) fail('EXPORT_SOURCE_NOT_DIRECTORY', '원본은 폴더여야 합니다.');
  const real = await realpath(source);
  if (!sameCase(real, source)) fail('EXPORT_LINK_REFUSED', '원본 경로에 바로가기(링크)가 섞여 있습니다. 실제 폴더 경로로 다시 실행해 주세요.', { path: '.' });
  for (const rel of ['package.json', 'src/server.mjs', 'student/extension.mjs']) {
    let st; try { st = await lstat(join(source, ...rel.split('/'))); } catch { st = null; }
    if (!st || !st.isFile()) fail('EXPORT_SOURCE_NOT_ALEKOV', `4차 시작 틀 프로젝트 폴더가 아닙니다. ${rel} 파일이 없습니다. on-client 폴더를 지정해 주세요.`, { missing: rel });
  }
  let pkg;
  try { pkg = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await stableRead(join(source, 'package.json'))).bytes)); } catch(error) { if(error instanceof ExportError)throw error;fail('EXPORT_SOURCE_NOT_ALEKOV', 'package.json 을 읽지 못했습니다.'); }
  if (pkg?.name !== 'alekov-client-starter') fail('EXPORT_SOURCE_NOT_ALEKOV', '4차 시작 틀에서 만든 프로젝트가 아닙니다(package.json 이름이 다릅니다).');
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkg[key] && Object.keys(pkg[key]).length) fail('EXPORT_DEPENDENCY_PRESENT', `package.json 에 ${key} 가 있습니다. 이 패키지는 외부 의존성 없이 실행하는 구조만 지원합니다.`, { key });
  }
  return pkg;
}

async function assertNewOutput(out, source) {
  const parent = dirname(out);
  let st;
  try { st = await lstat(out); } catch { st = null; }
  if (st) fail('EXPORT_OUTPUT_EXISTS', '출력 폴더가 이미 있습니다. 기존 폴더는 덮어쓰지 않습니다. 아직 없는 새 폴더 이름을 지정해 주세요.', { path: out });
  let pst;
  try { pst = await lstat(parent); } catch { pst = null; }
  if (!pst || !pst.isDirectory() || pst.isSymbolicLink()) fail('EXPORT_OUTPUT_PARENT_MISSING', '출력 폴더를 만들 상위 폴더가 없거나 실제 폴더가 아닙니다.', { path: parent });
  const realParent = await realpath(parent);
  const realOut = join(realParent, basename(out));
  if (isInside(realOut, source) || isInside(source, realOut)) fail('EXPORT_OUTPUT_OVERLAP', '출력 폴더는 원본 폴더 밖의 다른 위치여야 합니다.', { path: out });
  return realOut;
}

async function readStarterHashes(source) {
  try {
    const m = JSON.parse((await stableRead(join(source, '.on-starter-manifest.json'))).bytes.toString('utf8'));
    if (m && typeof m.sourceHashes === 'object' && m.sourceHashes) return m.sourceHashes;
  } catch(error) { if(error instanceof ExportError&&error.code!=='EXPORT_FILE_TOO_LARGE')throw error; /* 없거나 깨진 경우: 제공 파일 여부를 판정하지 않는다 */ }
  return null;
}

// 원본 폴더를 돌며 포함할 파일·제외 목록을 만든다. 쓰기는 하지 않는다.
export async function planExport(sourceInput) {
  const source = resolve(sourceInput);
  const sourceParents=await parents(source);
  const pkg = await assertAlekovSource(source);
  const starterHashes = await readStarterHashes(source);
  const files = [], excludedDirectories = [], secretFiles = [];
  let total = 0;
  async function walk(dirAbs, relDir) {
    const entries = await readdir(dirAbs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = join(dirAbs, entry.name);
      const st = await lstat(abs);
      if (st.isSymbolicLink()||st.isFile()&&st.nlink!==1) fail('EXPORT_LINK_REFUSED', `원본 안에 링크가 있어 내보내지 않았습니다: ${rel}. 파일을 지우지 말고 강사에게 이 메시지를 보여 주세요.`, { path: rel });
      if (st.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.includes(entry.name.toLowerCase())||rel==='src/learning'||rel==='tools/isolated-runner') { excludedDirectories.push(rel); continue; }
        await walk(abs, rel); continue;
      }
      if (!st.isFile()) fail('EXPORT_UNSUPPORTED_ENTRY', `일반 파일이 아닌 항목이 있어 내보내지 않았습니다: ${rel}`, { path: rel });
      if (!relDir && (entry.name === MANIFEST_NAME || entry.name === START_NAME)) continue; // 다시 내보낼 때 새로 만든다.
      if (SECRET_FILE_RULES.some(rule => rule(entry.name))) { secretFiles.push(rel); continue; }
      if (st.size > LIMITS.fileBytes) fail('EXPORT_FILE_TOO_LARGE', `파일이 너무 큽니다(10MB 초과): ${rel}`, { path: rel, bytes: st.size });
      total += st.size;
      if (total > LIMITS.totalBytes) fail('EXPORT_TOTAL_TOO_LARGE', '전체 크기가 60MB 를 넘습니다. 과제와 관계없는 큰 파일이 있는지 확인해 주세요.', { bytes: total });
      if (files.length + 1 > LIMITS.files) fail('EXPORT_TOO_MANY_FILES', `파일이 ${LIMITS.files}개를 넘습니다.`);
      if(!safePath(rel))fail('EXPORT_PATH_INVALID','지원하지 않는 파일 경로입니다.',{path:rel});
      const read = await stableRead(abs);const bytes=read.bytes;
      if (looksText(rel, bytes)) {
        const text = bytes.toString('utf8');
        for (const [kind, rule] of SECRET_CONTENT_RULES) {
          if (rule.test(text)) fail('EXPORT_SECRET_CONTENT', `${rel} 안에 ${kind}로 보이는 값이 있어 내보내지 않았습니다. 값을 대화창에 붙여 넣지 말고, 그 키를 발급한 곳에서 폐기한 뒤 파일에서 지우고 다시 실행해 주세요.`, { path: rel, kind });
        }
      }
      const digest = sha(bytes);
      let origin;
      if (rel.startsWith('student/')) origin = 'student';
      else if (rel === '.on-starter-manifest.json') origin = 'provided';
      else if (starterHashes && Object.prototype.hasOwnProperty.call(starterHashes, rel)) origin = starterHashes[rel] === digest ? 'provided' : 'provided-modified';
      else origin = 'student-added';
      files.push({ path: rel, bytes: bytes.length, sha256: digest, origin, abs,proof:read.proof });
    }
  }
  await walk(source, '');
  await checkParents(sourceParents);
  return { source, sourceParents,pkg, starterHashes, files, excludedDirectories, secretFiles, totalBytes: total };
}

async function renderStart({ appName, createdAt, starterVersion, fileCount,startCommand,demoCommand,launcher }) {
  const template = (await stableRead(TEMPLATE)).bytes.toString('utf8');
  return template.replaceAll('{{APP_NAME}}', appName).replaceAll('{{CREATED_AT}}', createdAt)
    .replaceAll('{{STARTER_VERSION}}', starterVersion).replaceAll('{{FILE_COUNT}}', String(fileCount)).replaceAll('{{START_COMMAND}}',startCommand).replaceAll('{{DEMO_COMMAND}}',demoCommand).replaceAll('{{LAUNCHER}}',launcher);
}

export async function exportStudentPackage({ source: sourceInput, out: outInput, appName: appNameInput, now = () => new Date() } = {}) {
  if (!sourceInput || !outInput) fail('EXPORT_ARGUMENT_INVALID', '--source 와 --out 을 모두 지정해 주세요.');
  const appName = normalizeAppName(appNameInput);
  const plan = await planExport(sourceInput);
  const out = await assertNewOutput(resolve(outInput), plan.source);
  const createdAt = now().toISOString();
  const starterVersion = String(plan.pkg.version || 'unknown');
  // 기존 학생 문서는 덮지 않는다. 제공할 안내와 다르면 원본을 보존한 채 전체 중단한다.
  const have = new Map(plan.files.map(f => [f.path,f]));
  const toolFiles = [];
  const supplied=[['tools/export-student-package.mjs',fileURLToPath(import.meta.url)],['tools/portable/START_HERE.template.md',TEMPLATE],['docs/AFTER_COURSE_GUIDE.md',join(HERE,'../docs/AFTER_COURSE_GUIDE.md')],['docs/FINAL_PACKAGE.md',join(HERE,'../docs/FINAL_PACKAGE.md')]];
  for(const rel of ['tools/portable/FINAL_RELEASE_CHECKLIST.template.md','tools/check-release-readiness.mjs','tools/install-portable-tools.mjs','docs/PERSONAL_AI_SETUP.md']){const abs=join(HERE,'..',...rel.split('/'));try{await lstat(abs);supplied.push([rel,abs]);}catch(e){if(e.code!=='ENOENT')throw e;}}
  for (const [rel, abs] of supplied) {
    const bytes = (await stableRead(abs)).bytes;
    if(have.has(rel)){if(have.get(rel).sha256!==sha(bytes))fail('EXPORT_SUPPLIED_CONFLICT',`기존 파일을 보존하기 위해 멈췄습니다: ${rel}. 차이를 검토하고 다시 진행하세요.`,{path:rel});continue;}
    toolFiles.push({ path: rel, bytes: bytes.length, sha256: sha(bytes), origin: 'package', data: bytes });
  }
  const checklist=supplied.find(([p])=>p==='tools/portable/FINAL_RELEASE_CHECKLIST.template.md');
  if(checklist){const bytes=(await stableRead(checklist[1])).bytes,rel='FINAL_RELEASE_CHECKLIST.md';if(!have.has(rel))toolFiles.push({path:rel,bytes:bytes.length,sha256:sha(bytes),origin:'package',data:bytes});}
  const effective=new Set([...have.keys(),...toolFiles.map(f=>f.path)]),standalone=have.has('src/standalone-server.mjs');
  if(standalone){for(const p of STANDALONE_FILES)if(!effective.has(p))fail('EXPORT_STANDALONE_INCOMPLETE',`독립 실행 구성 파일이 없습니다: ${p}. 도구 묶음을 확인하세요.`,{path:p});}
  const startCommand=standalone?'node src/standalone-server.mjs':'node src/server.mjs',demoCommand=startCommand+' --demo',launcher=standalone?'start-standalone.ps1':'start-alekov.ps1';
  const startBytes=Buffer.from(await renderStart({appName,createdAt,starterVersion,fileCount:plan.files.length+toolFiles.length+1,startCommand,demoCommand,launcher}),'utf8');
  const listed = [...plan.files.map(({ abs,proof, ...row }) => row), ...toolFiles.map(({ data, ...row }) => row), { path: START_NAME, bytes: startBytes.length, sha256: sha(startBytes), origin: 'package' }];
  const manifest = {
    schema: PACKAGE_SCHEMA, createdAt, appName,
    appNameNote: '앱 이름은 이 목록과 START_HERE.md 에만 들어갑니다. 앱 코드와 화면 제목은 바꾸지 않습니다.',
    starter: { packageVersion: starterVersion, starterManifest: plan.starterHashes ? 'present' : 'missing' },
    runtime: { node: typeof plan.pkg.engines?.node==='string'?plan.pkg.engines.node:null,exporterNode:process.version,start:startCommand,demo:demoCommand, defaultEngineMode: 'disconnected', workbenchRequired: false, portalRequired: false },
    totals: { files: listed.length, bytes: listed.reduce((s, f) => s + f.bytes, 0) },
    files: listed,
    excluded: { directories: plan.excludedDirectories, secretFiles: plan.secretFiles }
  };
  validateManifest(manifest);
  const outputParents=await parents(dirname(out));await checkParents(plan.sourceParents);
  const tmp = join(dirname(out), `.${basename(out)}.partial-${randomBytes(6).toString('hex')}`);
  await mkdir(tmp);
  const outputGuards=[...outputParents,...await parents(tmp)];const written=[];
  try {
    for (const file of plan.files) {
      await checkParents(plan.sourceParents);await checkParents(outputGuards);
      const read = await stableRead(file.abs);const bytes=read.bytes;
      if (read.proof!==file.proof||sha(bytes) !== file.sha256) fail('EXPORT_SOURCE_CHANGED', `내보내는 사이 원본 파일이 바뀌었습니다: ${file.path}. 저장을 마친 뒤 다시 실행해 주세요.`, { path: file.path });
      const target = join(tmp, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await parents(dirname(target));await checkParents(outputGuards);
      await writeFile(target, bytes, { flag: 'wx' });
      written.push(file.path);
    }
    for (const file of toolFiles) {
      const target = join(tmp, ...file.path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await parents(dirname(target));await checkParents(outputGuards);
      await writeFile(target, file.data, { flag: 'wx' });
      written.push(file.path);
    }
    await writeFile(join(tmp, START_NAME), startBytes, { flag: 'wx' });
    await writeFile(join(tmp, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    await checkParents(outputGuards);await checkParents(plan.sourceParents);
    const verified=await verifyStudentPackage(tmp);if(!verified.ok)fail('EXPORT_OUTPUT_CHANGED','기록한 파일이 달라 내보내기를 완료하지 않았습니다.');
    let raced = null; try { raced = await lstat(out); } catch { /* 없음이 정상 */ }
    if (raced) fail('EXPORT_OUTPUT_EXISTS', '내보내는 사이 같은 이름의 출력 폴더가 생겼습니다. 다른 이름으로 다시 실행해 주세요.', { path: out });
    await rename(tmp, out);
  } catch (error) {
    // 경합 중 경로를 믿고 재귀 삭제하지 않는다. 자기 임시 산출물도 보존하고 정확한 위치를 안내한다.
    throw new ExportError(error instanceof ExportError?error.code:'EXPORT_WRITE_FAILED',`${error instanceof ExportError?error.message:'파일을 모두 기록하지 못했습니다.'} 부분 결과는 보존했습니다: ${tmp}`,{...(error instanceof ExportError?error.detail:{}),partialDirectory:tmp,written});
  }
  return { out, manifest };
}

// 패키지 폴더의 파일을 목록과 다시 대조한다. 바꾸지 않는다.
function validateManifest(m){
  const bad=()=>fail('VERIFY_MANIFEST_INVALID','패키지 목록의 필드·경로·해시·필수 파일·합계를 확인하세요.');
  if(!exact(m,['schema','createdAt','appName','appNameNote','starter','runtime','totals','files','excluded'])||m.schema!==PACKAGE_SCHEMA||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||new Date(m.createdAt).toISOString()!==m.createdAt||typeof m.appName!=='string'||normalizeAppName(m.appName)!==m.appName||typeof m.appNameNote!=='string'||m.appNameNote.length>500)bad();
  if(!exact(m.starter,['packageVersion','starterManifest'])||typeof m.starter.packageVersion!=='string'||m.starter.packageVersion.length>128||!['present','missing'].includes(m.starter.starterManifest))bad();
  if(!exact(m.runtime,['node','exporterNode','start','demo','defaultEngineMode','workbenchRequired','portalRequired'])||m.runtime.node!==null&&(typeof m.runtime.node!=='string'||m.runtime.node.length>128)||typeof m.runtime.exporterNode!=='string'||!/^v\d+\.\d+\.\d+$/.test(m.runtime.exporterNode)||!['node src/server.mjs','node src/standalone-server.mjs'].includes(m.runtime.start)||m.runtime.demo!==m.runtime.start+' --demo'||m.runtime.defaultEngineMode!=='disconnected'||m.runtime.workbenchRequired!==false||m.runtime.portalRequired!==false)bad();
  if(!exact(m.totals,['files','bytes'])||!Array.isArray(m.files)||m.files.length<1||m.files.length>LIMITS.files||!exact(m.excluded,['directories','secretFiles']))bad();
  for(const list of [m.excluded.directories,m.excluded.secretFiles])if(!Array.isArray(list)||list.length>LIMITS.files||list.some(p=>!safePath(p))||new Set(list.map(p=>p.toLowerCase())).size!==list.length)bad();
  const seen=new Set();let bytes=0;
  for(const f of m.files){if(!exact(f,['path','bytes','sha256','origin'])||!safePath(f.path)||f.path===MANIFEST_NAME||seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>LIMITS.fileBytes||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||!['student','provided','provided-modified','student-added','package'].includes(f.origin))bad();seen.add(f.path.toLowerCase());bytes+=f.bytes;}
  if(bytes>LIMITS.totalBytes||m.totals.files!==m.files.length||m.totals.bytes!==bytes)bad();
  for(const p of ['package.json','README.md','.env.example','src/server.mjs','student/extension.mjs',START_NAME,'tools/export-student-package.mjs','tools/portable/START_HERE.template.md','docs/AFTER_COURSE_GUIDE.md','docs/FINAL_PACKAGE.md'])if(!seen.has(p.toLowerCase()))bad();
  if(seen.has('tools/portable/final_release_checklist.template.md')&&!seen.has('final_release_checklist.md'))bad();
  if(m.runtime.start==='node src/standalone-server.mjs')for(const p of STANDALONE_FILES)if(!seen.has(p.toLowerCase()))bad();
  if(seen.has('src/standalone-server.mjs')&&m.runtime.start!=='node src/standalone-server.mjs')bad();
}
export async function verifyStudentPackage(dirInput) {
  const dir = resolve(dirInput);
  const guards=await parents(dir);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await stableRead(join(dir,MANIFEST_NAME),1048576)).bytes)); } catch(error) {if(error instanceof ExportError)throw error;fail('VERIFY_MANIFEST_MISSING', `${MANIFEST_NAME} 을 읽지 못했습니다.`); }
  validateManifest(manifest);
  const problems = [];
  const expected = new Map(manifest.files.map(f => [f.path, f]));
  const seen = new Set();
  let entries=0;
  async function walk(abs, relDir) {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const p = join(abs, entry.name);
      const st = await lstat(p);
      if(++entries>LIMITS.files*4)fail('VERIFY_MANIFEST_INVALID','패키지 항목이 너무 많습니다.');
      await checkParents(guards);
      if (st.isSymbolicLink()||st.isFile()&&st.nlink!==1) { problems.push({ path: rel, problem: 'link' }); continue; }
      if (st.isDirectory()) { await walk(p, rel); continue; }
      if (!relDir && entry.name === MANIFEST_NAME) continue;
      const row = expected.get(rel);
      if (!row) { problems.push({ path: rel, problem: 'extra' }); continue; }
      seen.add(rel);
      if(!st.isFile()){problems.push({path:rel,problem:'link'});continue;}
      const bytes = (await stableRead(p)).bytes;
      if (bytes.length !== row.bytes || sha(bytes) !== row.sha256) problems.push({ path: rel, problem: 'changed' });
    }
  }
  await walk(dir, '');
  await checkParents(guards);
  for (const rel of expected.keys()) if (!seen.has(rel) && !problems.some(p => p.path === rel)) problems.push({ path: rel, problem: 'missing' });
  return { ok: problems.length === 0, files: manifest.files.length, problems };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i], value = argv[i + 1];
    if (!['--source', '--out', '--app-name', '--verify'].includes(key) || value === undefined || value.startsWith('--') || opts[key] !== undefined) fail('EXPORT_ARGUMENT_INVALID', `인자를 확인해 주세요: ${key}`);
    opts[key] = value; i++;
  }
  if (opts['--verify'] !== undefined && Object.keys(opts).length !== 1) fail('EXPORT_ARGUMENT_INVALID', '--verify 는 다른 인자와 함께 쓰지 않습니다.');
  return opts;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts['--verify'] !== undefined) {
      const result = await verifyStudentPackage(opts['--verify']);
      if (result.ok) { console.log(`확인했습니다. 목록의 파일 ${result.files}개가 모두 그대로입니다.`); return; }
      console.error('목록과 다른 파일이 있습니다. 파일을 지우지 말고 아래 목록을 확인해 주세요.');
      for (const p of result.problems) console.error(`- ${p.path}: ${({ changed: '내용이 바뀜', missing: '없음', extra: '목록에 없는 파일', link: '바로가기(링크)' })[p.problem]}`);
      process.exitCode = 2; return;
    }
    const { out, manifest } = await exportStudentPackage({ source: opts['--source'], out: opts['--out'], appName: opts['--app-name'] });
    const counts = manifest.files.reduce((m, f) => (m[f.origin] = (m[f.origin] || 0) + 1, m), {});
    console.log(`내보냈습니다: ${out}`);
    console.log(`파일 ${manifest.totals.files}개(student 폴더 ${counts.student || 0}, 기존 목록에 없는 파일 ${counts['student-added'] || 0}, 변경된 제공 파일 ${counts['provided-modified'] || 0}, 제공 파일 ${counts.provided || 0})`);
    if (manifest.excluded.secretFiles.length) console.log(`비밀 설정 파일 ${manifest.excluded.secretFiles.length}개는 넣지 않았습니다: ${manifest.excluded.secretFiles.join(', ')}`);
    if (manifest.excluded.directories.length) console.log(`넣지 않은 폴더: ${manifest.excluded.directories.join(', ')}`);
    console.log(`다음 단계: 새 폴더의 ${START_NAME} 를 열어 실행 방법을 확인하세요.`);
  } catch (error) {
    if (error instanceof ExportError) { console.error(`[${error.code}] ${error.message}`); process.exitCode = 1; return; }
    console.error(`[EXPORT_FAILED] 내보내기를 마치지 못했습니다. 원본은 바뀌지 않았습니다. (${error.code || error.name})`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
