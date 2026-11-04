// 학생 꾸밈 파일 읽기 — 읽기 전용. 학생 원본을 쓰거나 고치지 않는다.
// student/appearance.json 과 꾸밈이 고른 그림(최대 2개)만 읽는다. 목록 보기·임의 student 파일 읽기는 없다.
// 각 파일: 일반 파일·링크 1개·링크/junction 상위 없음·실제 경로 일치·읽는 동안 identity 불변·정확 byte 상한.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {APPEARANCE_FILE,APPEARANCE_LIMITS,appearanceProblem,inspectAppearanceImage,parseStudentAppearance,selectedAppearanceImages} from './student-appearance.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const identity=s=>[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
const directoryIdentity=s=>[s.dev,s.ino,s.birthtimeNs].map(String).join(':');
class AppearanceFileError extends Error{constructor(code){super(code);this.code=code;}}
const unsafe=()=>{throw new AppearanceFileError('APPEARANCE_FILE_UNSAFE');},changed=()=>{throw new AppearanceFileError('APPEARANCE_FILE_CHANGED');};
// 학생 파일 문제(링크·교체·변경)는 꾸밈 오류다. 설치형 projection 은 이 코드들을 복사 거절로 다룬다.
export const APPEARANCE_REFUSAL_CODES=Object.freeze(['APPEARANCE_FILE_UNSAFE','APPEARANCE_FILE_CHANGED','APPEARANCE_READ_FAILED']);

async function directories(root,from){
  const held=[];
  for(let p=from;;p=path.dirname(p)){
    const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||!same(await fs.realpath(p),p))unsafe();
    held.push([p,directoryIdentity(s)]);if(same(p,root))return held;if(path.dirname(p)===p)unsafe();
  }
}
async function heldSame(held){for(const [p,id] of held){const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||directoryIdentity(s)!==id||!same(await fs.realpath(p),p))changed();}}
// → null(없음) | {tooLarge:true} | {bytes,sha256,identity}
async function stableFile(root,relative,max){
  const file=path.join(root,...relative.split('/'));
  if(!(process.platform==='win32'?file.toLowerCase().startsWith(root.toLowerCase()+path.sep):file.startsWith(root+path.sep)))unsafe();
  let named;try{named=await fs.lstat(file,{bigint:true});}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;}
  const held=await directories(root,path.dirname(file));
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1n||!same(await fs.realpath(file),file))unsafe();
  if(named.size>BigInt(max))return {tooLarge:true};
  // 같은 열린 handle에서 max+1 고정 buffer로만 위치 지정 읽기를 한다: 실제 읽기량·할당은 max+1을 넘지 않는다.
  // max+1번째 바이트가 읽히면(읽는 중 성장) 더 읽지 않고 변경으로 거절한다. 원본은 고치거나 지우지 않는다.
  const fd=await fs.open(file,'r');let bytes;
  try{const opened=await fd.stat({bigint:true});if(identity(opened)!==identity(named))changed();
    const buffer=Buffer.alloc(max+1);let total=0;
    while(total<buffer.length){const {bytesRead}=await fd.read(buffer,total,buffer.length-total,total);if(bytesRead===0)break;total+=bytesRead;}
    if(total>max)changed();bytes=buffer.subarray(0,total);
    const after=await fd.stat({bigint:true});if(identity(after)!==identity(opened)||bytes.length!==Number(opened.size))changed();}
  finally{await fd.close();}
  const last=await fs.lstat(file,{bigint:true});if(identity(last)!==identity(named))changed();await heldSame(held);
  return {bytes,sha256:sha(bytes),identity:identity(named)};
}
const invalid=(problem,json=null)=>Object.freeze({state:'invalid',problem,json});

// appRoot 의 꾸밈을 읽는다. → {state:'absent'} | {state:'invalid',problem,json} | {state:'valid',value,json,images}
// json/images 의 bytes·sha256 은 검증한 바로 그 원본 byte 이다.
export async function readStudentAppearance(appRoot){
  try{
    if(typeof appRoot!=='string'||!path.isAbsolute(appRoot))return invalid(appearanceProblem('APPEARANCE_READ_FAILED'));
    const root=path.resolve(appRoot);
    const read=await stableFile(root,APPEARANCE_FILE,APPEARANCE_LIMITS.json);
    if(read===null)return Object.freeze({state:'absent'});
    if(read.tooLarge)return invalid(appearanceProblem('APPEARANCE_JSON_TOO_LARGE'));
    const json=Object.freeze({path:APPEARANCE_FILE,bytes:read.bytes,sha256:read.sha256}),parsed=parseStudentAppearance(read.bytes);
    if(!parsed.ok)return invalid(parsed.problem,json);
    const images=[];
    for(const selected of selectedAppearanceImages(parsed.value)){
      let image;try{image=await stableFile(root,selected.relative,selected.max);}catch(error){if(error instanceof AppearanceFileError)return invalid(appearanceProblem(error.code,selected.relative,selected.kind),json);throw error;}
      if(image===null)return invalid(appearanceProblem('APPEARANCE_IMAGE_MISSING',selected.relative,selected.kind),json);
      if(image.tooLarge)return invalid(appearanceProblem('APPEARANCE_IMAGE_TOO_LARGE',selected.relative,selected.kind),json);
      const checked=inspectAppearanceImage(selected.kind,selected.name,image.bytes);if(!checked.ok)return invalid(checked.problem,json);
      images.push(Object.freeze({...selected,path:selected.relative,bytes:image.bytes,sha256:image.sha256,width:checked.width,height:checked.height}));
    }
    return Object.freeze({state:'valid',value:parsed.value,json,images:Object.freeze(images)});
  }catch(error){
    if(error instanceof AppearanceFileError)return invalid(appearanceProblem(error.code));
    return invalid(appearanceProblem('APPEARANCE_READ_FAILED'));
  }
}
// 변경 검출용 원본 목록(경로·byte 수·SHA). absent 는 빈 목록이다.
export function appearanceFiles(read){
  const rows=[];if(read?.json)rows.push({path:read.json.path,bytes:read.json.bytes.length,sha256:read.json.sha256});
  for(const image of read?.state==='valid'?read.images:[])rows.push({path:image.path,bytes:image.bytes.length,sha256:image.sha256});
  return Object.freeze(rows.map(Object.freeze));
}
