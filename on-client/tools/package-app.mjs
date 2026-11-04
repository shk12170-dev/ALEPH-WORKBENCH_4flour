#!/usr/bin/env node
// C2 installer package: source read-only; new exclusive output; no launch/deploy/AI.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,fail,appName,planApp,sourceProvenance,stableRead,guards,checkGuards,inside,pngIcon,makeZip,checkContent,RUNTIME_SUPPORT,readRuntimeSupport} from './package-app-support.mjs';
import {resolveHostProvidedRuntime,PROVIDED_RUNTIME_LIMITS} from './provided-runtime.mjs';
import {createPackageFinishMaterialExporter} from './package-finish-materials.mjs';
import {appearanceFiles,readStudentAppearance} from '../src/student-appearance-files.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
// Full app (v2): the operator-approved immutable runtime.zip from this PC's fixed host cache, copied byte-for-byte (never
// rebuilt), plus the v2 section derived from those actual bytes. The student app source stays in app.zip; learning and the
// isolated runner come only from the provided runtime. This command never grants approval: C3 verifies the signed catalog
// and the approved normal-app host verifies the signed app release before anything runs.
async function hostRuntime(){
  let view;try{view=await resolveHostProvidedRuntime();}catch(error){fail(['PROVIDED_RUNTIME_NOT_INSTALLED','PROVIDED_RUNTIME_AMBIGUOUS'].includes(error.code)?error.code:'PACKAGE_RUNTIME_UNVERIFIED');}
  const read=await stableRead(view.archivePath,PROVIDED_RUNTIME_LIMITS.archive);if(read.bytes.length!==view.section.archive.bytes||sha(read.bytes)!==view.section.archive.sha256)fail('PACKAGE_RUNTIME_UNVERIFIED');
  return {zip:read.bytes,section:view.section};
}
// Optional student/appearance.json: the same shared validator as the screen. Its name/icon bytes are bound only through the
// existing student file/SHA rows (no new manifest field). The student's files are never edited; a problem stops with file+reason.
const appearanceStop=(code,file,field,reason)=>{throw Object.assign(Error(code),{code,file,field,reason});};
async function studentAppearance(source){
  const read=await readStudentAppearance(path.resolve(source));
  if(read.state==='invalid')appearanceStop('PACKAGE_APPEARANCE_INVALID',read.problem.file,read.problem.field,read.problem.code);
  return read.state==='valid'?read:null;
}
// runtime: undefined = v1 app package (explicit compatibility path); 'host' = v2 full app from the approved host runtime.
export async function packageApp({source,out,iconPath,name,finishMaterials=false,runtime}={}){
  if(!source||!out)fail('PACKAGE_ARGUMENT_REQUIRED');
  const declared=await studentAppearance(source),declaredIcon=declared?.images.find(row=>row.kind==='icon')??null,declaredName=declared?.value.appName??null;
  if(!iconPath&&!declaredIcon)fail('PACKAGE_ARGUMENT_REQUIRED');
  if(typeof finishMaterials!=='boolean'||runtime!==undefined&&runtime!=='host')fail('PACKAGE_ARGUMENT_INVALID');
  if(declaredName!==null&&appName(declaredName)!==declaredName)appearanceStop('PACKAGE_APPEARANCE_INVALID','student/appearance.json','appName','APPEARANCE_APP_NAME_INVALID');
  if(name!==undefined&&declaredName!==null&&appName(name)!==declaredName)appearanceStop('PACKAGE_APPEARANCE_CONFLICT','student/appearance.json','appName','APP_NAME_DIFFERS_FROM_APPEARANCE');
  const fullApp=runtime==='host'?await hostRuntime():null;
  const label=appName(name??declaredName??undefined),plan=await planApp(source,{providedRuntime:!!fullApp}),target=path.resolve(out),parent=path.dirname(target);
  // The appearance actually packaged is the one read now from the planned source, byte-equal to its student file rows.
  const bound=await studentAppearance(plan.source),boundFiles=JSON.stringify(appearanceFiles(bound));
  if(boundFiles!==JSON.stringify(appearanceFiles(declared)))fail('PACKAGE_SOURCE_CHANGED');
  for(const row of appearanceFiles(bound)){const planned=plan.files.find(file=>file.path===row.path);if(!planned||planned.sha256!==row.sha256||planned.bytes!==row.bytes)fail('PACKAGE_SOURCE_CHANGED');}
  if(inside(target,plan.source)||inside(plan.source,target))fail('PACKAGE_OUTPUT_OVERLAP');
  const outputGuards=await guards(parent),sourceGuards=await guards(plan.source);
  try{await fs.lstat(target);fail('PACKAGE_OUTPUT_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  const iconFile=iconPath?path.resolve(iconPath):path.join(plan.source,...declaredIcon.path.split('/'));
  const icon=await stableRead(iconFile,1024*1024);checkContent(icon.bytes);
  if(declaredIcon&&sha(icon.bytes)!==declaredIcon.sha256)appearanceStop(iconPath?'PACKAGE_APPEARANCE_CONFLICT':'PACKAGE_SOURCE_CHANGED',declaredIcon.path,'icon',iconPath?'ICON_DIFFERS_FROM_APPEARANCE':'ICON_CHANGED');
  const ico=pngIcon(icon.bytes),entries=[],rows=[];
  for(const row of plan.files){
    const current=await stableRead(row.abs);if(current.proof!==row.proof||sha(current.bytes)!==row.sha256)fail('PACKAGE_SOURCE_CHANGED');
    try{checkContent(current.bytes);}catch(error){error.path=row.path;throw error;}
    entries.push({path:'education/on-client/'+row.path,data:current.bytes});rows.push({path:'education/on-client/'+row.path,bytes:row.bytes,sha256:row.sha256,origin:row.origin});
  }
  // v1 only: the fixed support calculator for the bundled learning modules (v2 learning comes from the provided runtime).
  const support=fullApp?null:await readRuntimeSupport();if(support){entries.push({path:RUNTIME_SUPPORT.path,data:support.bytes});
  rows.push({path:RUNTIME_SUPPORT.path,bytes:support.bytes.length,sha256:RUNTIME_SUPPORT.sha256,origin:'provided'});}
  const generated='education/on-client/package-assets/app.ico';if(entries.some(row=>row.path.toLowerCase()===generated))fail('PACKAGE_GENERATED_COLLISION');
  entries.push({path:generated,data:ico});rows.push({path:generated,bytes:ico.length,sha256:sha(ico),origin:'package'});
  const finishExporter=finishMaterials?await createPackageFinishMaterialExporter(plan):null;
  const provenance=finishExporter?.provenance??await sourceProvenance(plan),zip=makeZip(entries),installer=(await stableRead(path.join(HERE,'install-packaged-app.ps1'))).bytes;
  const manifest={schema:fullApp?'alekov.install-package.v2':'alekov.install-package.v1',createdAt:new Date().toISOString(),appName:label,sourceVersion:plan.pkg.version,
    runtime:fullApp?{node:plan.pkg.engines?.node??null,start:'host/start-installed-normal-app.ps1',learningIncluded:true,autoLaunch:false,support:null}:{node:plan.pkg.engines?.node??null,start:'education/on-client/tools/start-alekov.ps1',learningIncluded:true,autoLaunch:false,support:RUNTIME_SUPPORT},
    archive:{name:'app.zip',bytes:zip.length,sha256:sha(zip)},installer:{name:'install-app.ps1',sha256:sha(installer)},
    icon:{inputPngSha256:sha(icon.bytes),path:generated,conversion:'unchanged-png-in-ico'},source:provenance,files:rows,excluded:plan.excluded,...(fullApp?{fullAppRuntime:fullApp.section}:{})};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const finish=finishExporter?await finishExporter.collect():null;
  if(finish&&(zip.length>70*1024*1024||bytes.length>2*1024*1024))fail('PACKAGE_LIMIT_EXCEEDED');
  await checkGuards(outputGuards);await checkGuards(sourceGuards);
  // mkdir without recursive is the exclusive claim. On failure, preserve partial output for inspection.
  await fs.mkdir(target);const claimed=await guards(target);
  try{
    const outputFiles=[['app.zip',zip],...(fullApp?[['runtime.zip',fullApp.zip]]:[]),['install-app.ps1',installer],['INSTALL.md',Buffer.from(
      `# ${label} 설치\n\nWindows와 Node.js 22~24가 필요합니다. 기존 프로젝트와 개인 설정은 덮어쓰지 않습니다.\n\n`+
      `새 PowerShell에서 아래 명령의 설치 경로를 아직 없는 새 폴더로 바꿔 실행하세요. 바탕화면 바로가기는 -CreateDesktopShortcut을 명시할 때만 만듭니다. 설치 중 앱을 실행하지 않습니다.\n\n`+
      `powershell -NoProfile -ExecutionPolicy Bypass -File .\\install-app.ps1 -Destination "C:\\Apps\\내 앱" -ManifestSha256 ${sha(bytes)} -CreateDesktopShortcut\n\n`+
      (fullApp?`이 묶음은 설치형 전체 앱입니다. runtime.zip은 이 PC에 미리 설치된 승인 실행 환경을 그대로 복사한 것입니다(고정 Node·실행 환경·공개 시작 기록·서명된 앱 출시 정보). 바로가기는 따로 승인된 실행 host를 실행하고, 그 host가 서명과 실행 환경 파일을 모두 확인한 뒤에만 앱을 켭니다. 확인에 실패하면 기존 개발용 실행으로 바꿔 켜지 않고 멈춥니다. 이 묶음은 승인을 만들거나 대신하지 않습니다. 계정 연결용 개인 설정은 host가 이 설치 전용 위치에 준비하며 ZIP에 자격·vault·registry를 넣지 않습니다.\n\n`:`설치 후 바로가기는 기존 tools/start-alekov.ps1을 실행합니다. 계정 연결용 개인 설정·ACL은 해당 실행기가 프로젝트별로 준비하며 ZIP에 자격·vault·registry를 넣지 않습니다.\n\n`)+
      `설치 실패 시 부분 폴더를 보존합니다. 내용을 확인한 후 다른 새 경로에서 다시 설치하세요. 기존 파일을 강제로 삭제하거나 덮어쓰지 않습니다.\n\n`+
      `포함 소스 SHA256: ${provenance.snapshot.sha256}\nGit HEAD: ${provenance.git.head??'NOT_RUN — Git 이력 없음'}\n제출 확인 상태: ${provenance.submission.state} (C3 검증 필요)\n\n`+
      (finish?`마무리 화면에서 아래 네 파일을 각각 선택하세요. 파일 이름을 바꾸거나 ZIP을 다시 만들 필요가 없습니다.\n\n- 커밋 원문: finish.commit.raw\n- 소스 묶음: finish.archive.tar.gz\n- 설치 파일: app.zip\n- 파일 목록: APP_PACKAGE_MANIFEST.json\n\n네 파일은 같은 작업에서 만든 한 묶음입니다. 다른 폴더의 파일과 섞지 마세요. 등록 후 안내되는 확인 단계를 계속 진행하세요.\n\n`:``)+
      `무결성 해시는 바이트 일치를 확인하며 배포자 서명이나 13~22 공식 통과 증거는 아닙니다. 실제 연결·유료 AI·운영 상태는 별도 확인이 필요합니다.\n`,'utf8')],...(finish?.files??[])];
    async function checkOutput(published=false){
      const expected=published?[...outputFiles,['APP_PACKAGE_MANIFEST.json',bytes]]:outputFiles;
      const names=(await fs.readdir(target)).sort(),wanted=expected.map(([name])=>name).sort();
      if(JSON.stringify(names)!==JSON.stringify(wanted))fail('PACKAGE_OUTPUT_CHANGED');
      for(const [name,data] of expected)if(sha((await stableRead(path.join(target,name),name==='app.zip'?(finish?70:74)*1024*1024:name==='runtime.zip'?200*1024*1024:name==='finish.archive.tar.gz'?25*1024*1024:name==='finish.commit.raw'?1024*1024:2097152)).bytes)!==sha(data))fail('PACKAGE_OUTPUT_CHANGED');
      await checkGuards(claimed);
    }
    for(const [name,data] of outputFiles){
      await checkGuards(claimed);await fs.writeFile(path.join(target,name),data,{flag:'wx'});
    }
    // Replan as well as re-read: new/deleted files and changed exclusions also
    // invalidate the source snapshot, not just edits to already selected files.
    const after=await planApp(plan.source,{providedRuntime:!!fullApp}),projection=rows=>rows.map(({path,bytes,sha256,origin,proof})=>({path,bytes,sha256,origin,proof}));
    if(JSON.stringify(projection(plan.files))!==JSON.stringify(projection(after.files))||JSON.stringify(plan.excluded)!==JSON.stringify(after.excluded))fail('PACKAGE_SOURCE_CHANGED');
    if(JSON.stringify(await (finishExporter?finishExporter.provenanceFor(after):sourceProvenance(after)))!==JSON.stringify(provenance))fail('PACKAGE_SOURCE_CHANGED');
    if(sha((await stableRead(iconFile,1024*1024)).bytes)!==sha(icon.bytes))fail('PACKAGE_SOURCE_CHANGED');
    if(JSON.stringify(appearanceFiles(await studentAppearance(after.source)))!==boundFiles)fail('PACKAGE_SOURCE_CHANGED');
    if(support&&(await readRuntimeSupport()).proof!==support.proof)fail('PACKAGE_SUPPORT_CHANGED');
    await finish?.assertCurrent();
    await checkOutput();
    await checkGuards(sourceGuards);await checkGuards(claimed);
    // Publish a fully synced manifest atomically without replacing a competing
    // file. The temporary second link is removed before success is returned.
    const pendingManifest=path.join(target,'.APP_PACKAGE_MANIFEST.partial');
    const manifestHandle=await fs.open(pendingManifest,'wx');try{await manifestHandle.writeFile(bytes);await manifestHandle.sync();}finally{await manifestHandle.close();}
    await fs.link(pendingManifest,path.join(target,'APP_PACKAGE_MANIFEST.json'));
    await fs.unlink(pendingManifest);
    await finish?.assertCurrent();
    await checkOutput(true);
    await checkGuards(claimed);
  }catch(error){throw Object.assign(Error('PACKAGE_INCOMPLETE_OUTPUT_PRESERVED'),{code:'PACKAGE_INCOMPLETE_OUTPUT_PRESERVED',causeCode:error.code??'PACKAGE_FAILED'});}
  return {out:target,manifestSha256:sha(bytes),files:rows.length,manifest};
}
async function main(){
  try{const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(Object.hasOwn(options,key))fail('PACKAGE_ARGUMENT_INVALID');if(key==='--finish-materials'||key==='--app-only-v1'){options[key]=true;continue;}const value=process.argv[++i];if(!['--source','--out','--iconPath','--app-name'].includes(key)||!value||value.startsWith('--'))fail('PACKAGE_ARGUMENT_INVALID');options[key]=value;}
    // Default: the full app (v2) with this PC's approved provided runtime. --app-only-v1 is the explicit separate
    // compatibility path for an app-only package; a missing runtime never silently becomes v1.
    const result=await packageApp({source:options['--source'],out:options['--out'],iconPath:options['--iconPath'],name:options['--app-name'],finishMaterials:options['--finish-materials']??false,...(options['--app-only-v1']?{}:{runtime:'host'})});
    console.log(JSON.stringify({ok:true,message:'설치용 묶음을 만들었습니다. INSTALL.md에서 설치 명령을 확인하세요. 소스 이력과 공식 제출 가능 여부는 source 항목을 확인하세요.',out:result.out,manifestSha256:result.manifestSha256,files:result.files,source:result.manifest.source}));
  }catch(error){const code=/^[A-Z_]+$/.test(error.code??'')?error.code:'PACKAGE_FAILED';const messages={
    PACKAGE_ARGUMENT_REQUIRED:'--source, --out, --iconPath를 모두 지정해 주세요.',
    PACKAGE_ARGUMENT_INVALID:'명령의 옵션 이름과 값을 확인해 주세요.',
    PACKAGE_APPEARANCE_INVALID:'꾸밈 파일 또는 그림에 문제가 있어 중단했습니다. file·reason에 적힌 파일을 고친 뒤 다시 실행하세요. 이 도구는 학생 파일을 고치지 않았습니다.',
    PACKAGE_APPEARANCE_CONFLICT:'명령에 적은 앱 이름 또는 아이콘이 꾸밈 파일(file)과 다릅니다. 옵션을 빼거나 같은 값으로 맞춘 뒤 다시 실행하세요. 이 도구는 학생 파일을 고치지 않았습니다.',
    PACKAGE_ICON_INVALID:'256×256, 8비트 RGB/RGBA, 비인터레이스 PNG 아이콘을 지정해 주세요.',
    PACKAGE_OUTPUT_EXISTS:'출력 폴더가 이미 있습니다. 아직 없는 새 폴더를 지정해 주세요.',
    PACKAGE_OUTPUT_OVERLAP:'출력 폴더는 원본 폴더 밖의 다른 위치여야 합니다.',
    PACKAGE_PRIVATE_CONFIGURATION:'개인 설정으로 보이는 파일이 있어 중단했습니다. 원본을 그대로 두고 포함 목록을 담당 강사와 확인해 주세요.',
    PACKAGE_RUNTIME_INCOMPLETE:'학습 기능이나 실행 도구가 빠졌습니다. 원본을 그대로 두고 담당 강사에게 마무리 단계용 도구 묶음을 확인해 주세요.',
    PACKAGE_SUPPORT_CHANGED:'고정 제공 코드가 없거나 다릅니다. 원본을 그대로 두고 담당 강사에게 도구 묶음을 확인해 주세요.',
    PROVIDED_RUNTIME_NOT_INSTALLED:'이 PC에 승인된 전체 앱 실행 환경이 아직 설치되지 않았습니다. 원본은 그대로 두었습니다. 담당자의 실행 환경 설치 안내를 기다려 주세요.',
    PROVIDED_RUNTIME_AMBIGUOUS:'이 PC의 승인 실행 환경을 하나로 정하지 못했습니다. 원본은 그대로 두었습니다. 담당자에게 이 메시지를 보여 주세요.',
    PACKAGE_RUNTIME_UNVERIFIED:'이 PC의 승인 실행 환경 파일을 확인하지 못했습니다. 원본은 그대로 두었습니다. 담당자에게 이 메시지를 보여 주세요.',
    PACKAGE_SECRET_CONTENT:'비밀로 보이는 값이 있어 중단했습니다. 값을 대화창에 붙여 넣지 말고 담당 강사와 파일을 확인해 주세요.',
    PACKAGE_FINISH_COMMIT_REQUIRED:'마무리 자료는 저장소에 기록된 최신 버전으로 만듭니다. 작업을 커밋한 뒤 다시 실행해 주세요.',
    PACKAGE_FINISH_GIT_CONTROL_REFUSED:'소스 이력을 안전하게 확인하지 못했습니다. 원본을 그대로 두고 담당 강사와 Git 설정과 포함 파일을 확인해 주세요.',
    PACKAGE_GIT_UNVERIFIABLE:'Git 이력을 확인하지 못해 중단했습니다. 원본을 그대로 두고 담당 강사와 저장소 상태를 확인해 주세요.',
    PACKAGE_INCOMPLETE_OUTPUT_PRESERVED:'작업 중 파일이 바뀌거나 확인에 실패했습니다. 부분 출력은 보존했으며 설치 완료로 사용하지 않습니다. 원본을 확인한 뒤 다른 새 경로로 다시 진행해 주세요.'};
    const detail=['PACKAGE_APPEARANCE_INVALID','PACKAGE_APPEARANCE_CONFLICT'].includes(code)?{file:error.file,field:error.field??null,reason:error.reason}:{};
    console.error(JSON.stringify({ok:false,code,message:messages[code]??'묶음을 만들지 못했습니다. 앱 폴더·아이콘·새 출력 경로를 확인해 주세요. 도구는 학생 원본을 수정하지 않습니다.',...detail}));process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
