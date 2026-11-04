// 학생 꾸밈(student/appearance.json) 계약 — 순수 검증·대비 보정·고정 CSS/DTO 생성만 한다. 파일 IO 없음.
// 꾸밈은 표시 데이터일 뿐이다. 권한·진도·통과·native/AI/모델·manifest origin 을 정하지 못하며 어떤 판정의 입력도 아니다.
// 서버 route, 설치형 projection, 포장(package-app)이 모두 이 한 검증기를 쓴다.
import {inflateSync} from 'node:zlib';

export const APPEARANCE_SCHEMA='alekov.student-appearance.v1';
export const APPEARANCE_VIEW_SCHEMA='alekov.student-appearance.view.v1';
export const APPEARANCE_FILE='student/appearance.json';
export const APPEARANCE_ASSET_DIR='student/assets';
export const APPEARANCE_PRESETS=Object.freeze(['default','student-first','compact']);
// 정확 byte 상한. 아이콘 상한은 포장 아이콘(package-app pngIcon)과 같다.
export const APPEARANCE_LIMITS=Object.freeze({json:4096,icon:1048576,startPicture:1048576,dimension:4096});
// 허용 그림은 고정 basename 뿐이다(student/assets/ 아래). 확장자와 실제 형식이 함께 맞아야 한다.
export const APPEARANCE_IMAGES=Object.freeze({icon:Object.freeze({'brand-icon.png':'image/png'}),startPicture:Object.freeze({'start-picture.png':'image/png','start-picture.webp':'image/webp'})});
export const APPEARANCE_DEFAULT_APP_NAME='케셰브';
export const APPEARANCE_APP_NAME_MAX=32;
const TOP_KEYS=Object.freeze(['schema','appName','icon','startPicture','palette','dashboardPreset']);
const PALETTE_KEYS=Object.freeze(['accent','background','surface']);
// 꾸밈으로 정할 수 없는 영역의 이름. 모르는 키와 같이 거절하되 이유를 따로 알린다.
const AUTHORITY_KEY=/^(?:auth|authority|approv|grant|permission|role|scope|pass|grade|score|progress|stage|submission|official|native|host|vault|registry|credential|token|secret|ai|model|provider|api|engine|manifest|origin|provided|runtime|sha256|digest|signature|trust|policy|url|href|src|css|style|html|script|selector)/i;

// 기본 제공 색(public/style.css :root)과 의미가 고정된 상태 색. 상태 색은 학생 색으로 바꾸지 않는다.
export const APPEARANCE_BASE_PALETTE=Object.freeze({accent:'#2357c6',background:'#f5f6f8',surface:'#ffffff'});
export const APPEARANCE_FIXED_FOREGROUNDS=Object.freeze({text:'#1c2430',muted:'#5a6472',allow:'#1d7a3e',deny:'#b42318',challenge:'#9a5b00',unknown:'#4b5563',student:'#6b3fb3'});
export const APPEARANCE_MIN_CONTRAST=4.5;

const MESSAGES=Object.freeze({
  APPEARANCE_JSON_TOO_LARGE:'꾸밈 파일이 4096바이트를 넘습니다.',
  APPEARANCE_JSON_ENCODING:'꾸밈 파일은 UTF-8 글자로 저장해 주세요.',
  APPEARANCE_JSON_SYNTAX:'꾸밈 파일의 JSON 형식이 올바르지 않습니다.',
  APPEARANCE_JSON_DUPLICATE_KEY:'같은 이름의 항목이 두 번 있습니다.',
  APPEARANCE_SCHEMA_INVALID:`"schema" 는 "${APPEARANCE_SCHEMA}" 이어야 합니다.`,
  APPEARANCE_FIELD_UNKNOWN:'꾸밈 파일에 정해지지 않은 항목이 있습니다.',
  APPEARANCE_FIELD_NOT_ALLOWED:'꾸밈 파일로는 권한·진도·연결·출처·코드 설정을 정할 수 없습니다.',
  APPEARANCE_FIELD_TYPE:'항목 값의 종류가 맞지 않습니다.',
  APPEARANCE_APP_NAME_INVALID:`앱 이름은 1~${APPEARANCE_APP_NAME_MAX}자이며 쓸 수 없는 글자(< > \` \\ / : " | ? * 등)가 없어야 합니다.`,
  APPEARANCE_COLOR_INVALID:'색은 #과 16진수 6자리(예: #2357c6)로 적어 주세요.',
  APPEARANCE_PRESET_INVALID:`배치는 ${APPEARANCE_PRESETS.join(', ')} 중 하나만 쓸 수 있습니다.`,
  APPEARANCE_IMAGE_NAME_INVALID:'정해진 그림 파일 이름만 쓸 수 있습니다(brand-icon.png, start-picture.png 또는 start-picture.webp).',
  APPEARANCE_IMAGE_PATH_REJECTED:'그림은 student/assets 안의 파일 이름만 적습니다. 폴더·상위 경로·절대 경로는 쓸 수 없습니다.',
  APPEARANCE_IMAGE_URL_REJECTED:'인터넷 주소·data 주소는 쓸 수 없습니다. 같은 폴더의 그림 파일만 씁니다.',
  APPEARANCE_IMAGE_SVG_REJECTED:'SVG·HTML 그림은 쓸 수 없습니다. PNG(시작 그림은 PNG 또는 WebP)를 쓰세요.',
  APPEARANCE_IMAGE_MISSING:'꾸밈 파일에 적은 그림 파일이 student/assets 에 없습니다.',
  APPEARANCE_IMAGE_TOO_LARGE:'그림 파일이 허용 크기(1MiB)를 넘습니다.',
  APPEARANCE_IMAGE_FORMAT:'그림 파일의 실제 형식이 맞지 않습니다. 아이콘은 256×256 8비트 RGB/RGBA 비인터레이스 PNG, 시작 그림은 4096 이하 PNG 또는 정지 WebP 입니다.',
  APPEARANCE_FILE_UNSAFE:'링크·바로가기·하드링크이거나 일반 파일이 아닌 항목은 쓰지 않습니다. 실제 파일로 저장해 주세요.',
  APPEARANCE_FILE_CHANGED:'읽는 중에 꾸밈 파일이나 폴더가 바뀌었습니다. 저장을 마친 뒤 앱을 다시 시작하세요.',
  APPEARANCE_READ_FAILED:'꾸밈 파일을 읽지 못했습니다.'
});
export const APPEARANCE_PROBLEM_CODES=Object.freeze(Object.keys(MESSAGES));
// 제어 글자·줄 구분 글자(코드 값으로 만든다).
const charRanges=(...pairs)=>'['+pairs.map(([a,b])=>String.fromCodePoint(a)+'-'+String.fromCodePoint(b)).join('')+']';
const FIELD_HIDDEN=new RegExp(charRanges([0x00,0x1f],[0x7f,0x9f],[0x2028,0x2029]),'g');
export function appearanceProblem(code,file=APPEARANCE_FILE,field=null){
  if(!Object.hasOwn(MESSAGES,code))code='APPEARANCE_READ_FAILED';
  // field 는 학생이 적은 키일 수 있다. 화면 안내용으로 짧게 자르고 제어 글자를 뺀다(textContent 로만 표시).
  const shown=field===null||field===undefined?null:[...String(field).replace(FIELD_HIDDEN,'')].slice(0,40).join('')||null;
  return Object.freeze({code,file,field:shown,message:MESSAGES[code]});
}
class AppearanceInputError extends Error{constructor(code,field=null){super(code);this.code=code;this.field=field;}}
const stop=(code,field)=>{throw new AppearanceInputError(code,field);};

// 작은 엄격 JSON 읽기. JSON.parse 와 달리 같은 키를 거절하고, 값 종류를 그대로 남긴다(깊이·크기 제한).
function parseStrict(text){
  let i=0;const ws=()=>{while(i<text.length&&' \t\n\r'.includes(text[i]))i++;};
  function string(){
    if(text[i]!=='"')stop('APPEARANCE_JSON_SYNTAX');i++;let out='';
    for(;;){if(i>=text.length)stop('APPEARANCE_JSON_SYNTAX');const c=text[i++];if(c==='"')return out;if(c<' ')stop('APPEARANCE_JSON_SYNTAX');
      if(c!=='\\'){out+=c;continue;}const e=text[i++];const simple={'"':'"','\\':'\\','/':'/',b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'};
      if(Object.hasOwn(simple,e)){out+=simple[e];continue;}if(e!=='u'||!/^[0-9a-fA-F]{4}$/.test(text.slice(i,i+4)))stop('APPEARANCE_JSON_SYNTAX');out+=String.fromCharCode(parseInt(text.slice(i,i+4),16));i+=4;}
  }
  function value(depth){
    if(depth>4)stop('APPEARANCE_JSON_SYNTAX');ws();const c=text[i];
    if(c==='{'){i++;const obj=Object.create(null),keys=[];ws();if(text[i]==='}'){i++;return {kind:'object',obj,keys};}
      for(;;){ws();const key=string();if(keys.includes(key))stop('APPEARANCE_JSON_DUPLICATE_KEY',key);ws();if(text[i++]!==':')stop('APPEARANCE_JSON_SYNTAX');obj[key]=value(depth+1);keys.push(key);ws();const n=text[i++];if(n==='}')return {kind:'object',obj,keys};if(n!==',')stop('APPEARANCE_JSON_SYNTAX');}}
    if(c==='['){i++;const items=[];ws();if(text[i]===']'){i++;return {kind:'array',items};}for(;;){items.push(value(depth+1));ws();const n=text[i++];if(n===']')return {kind:'array',items};if(n!==',')stop('APPEARANCE_JSON_SYNTAX');}}
    if(c==='"')return {kind:'string',value:string()};
    for(const [word,kind] of [['true','boolean'],['false','boolean'],['null','null']])if(text.startsWith(word,i)){i+=word.length;return {kind};}
    const m=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));if(m){i+=m[0].length;return {kind:'number'};}
    stop('APPEARANCE_JSON_SYNTAX');
  }
  const root=value(0);ws();if(i!==text.length)stop('APPEARANCE_JSON_SYNTAX');return root;
}

// 앱 이름: 포장 도구의 appName(normalizeAppName + 경로 안전 규칙)과 같은 규칙. 빈 이름은 꾸밈에서 명시 오류다.
export function normalizeAppearanceAppName(input){
  if(typeof input!=='string')return null;const name=input.normalize('NFC').trim();
  if(!name||[...name].length>APPEARANCE_APP_NAME_MAX)return null;
  if(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff<>`\\]/.test(name))return null;
  if(name.length>240||/[\\:\/]/.test(name)||/[<>"|?*]/.test(name)||/[. ]$/.test(name)||name==='.'||name==='..'||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))return null;
  return name;
}
function imageName(kind,value,field){
  if(typeof value!=='string')stop('APPEARANCE_FIELD_TYPE',field);
  if(Object.hasOwn(APPEARANCE_IMAGES[kind],value))return value;
  if(/^[A-Za-z]:(?:[\\/]|$)/.test(value))stop('APPEARANCE_IMAGE_PATH_REJECTED',field);
  if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//'))stop('APPEARANCE_IMAGE_URL_REJECTED',field);
  if(/[\\/]/.test(value)||value.includes('..'))stop('APPEARANCE_IMAGE_PATH_REJECTED',field);
  if(/\.(?:svgz?|html?|xhtml|xml|css|m?js)$/i.test(value)||/[<>]/.test(value))stop('APPEARANCE_IMAGE_SVG_REJECTED',field);
  stop('APPEARANCE_IMAGE_NAME_INVALID',field);
}
const HEX6=/^#[0-9a-fA-F]{6}$/;

// bytes(Uint8Array/Buffer) → {ok:true,value} | {ok:false,problem}. value 는 정규화된 고정 키만 가진다.
export function parseStudentAppearance(bytes){
  try{
    if(!(bytes instanceof Uint8Array))stop('APPEARANCE_READ_FAILED');
    if(bytes.length>APPEARANCE_LIMITS.json)stop('APPEARANCE_JSON_TOO_LARGE');
    let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{stop('APPEARANCE_JSON_ENCODING');}
    const root=parseStrict(text);
    if(root.kind!=='object')stop('APPEARANCE_FIELD_TYPE',null);
    for(const key of root.keys)if(!TOP_KEYS.includes(key))stop(AUTHORITY_KEY.test(key)?'APPEARANCE_FIELD_NOT_ALLOWED':'APPEARANCE_FIELD_UNKNOWN',key);
    const o=root.obj;if(o.schema?.kind!=='string'||o.schema.value!==APPEARANCE_SCHEMA)stop('APPEARANCE_SCHEMA_INVALID','schema');
    const value={schema:APPEARANCE_SCHEMA,appName:null,icon:null,startPicture:null,palette:null,dashboardPreset:'default'};
    if(o.appName){if(o.appName.kind!=='string')stop('APPEARANCE_FIELD_TYPE','appName');value.appName=normalizeAppearanceAppName(o.appName.value)??stop('APPEARANCE_APP_NAME_INVALID','appName');}
    if(o.icon){if(o.icon.kind!=='string')stop('APPEARANCE_FIELD_TYPE','icon');value.icon=imageName('icon',o.icon.value,'icon');}
    if(o.startPicture){if(o.startPicture.kind!=='string')stop('APPEARANCE_FIELD_TYPE','startPicture');value.startPicture=imageName('startPicture',o.startPicture.value,'startPicture');}
    if(o.palette){if(o.palette.kind!=='object')stop('APPEARANCE_FIELD_TYPE','palette');const palette={};
      for(const key of o.palette.keys){const field='palette.'+key;if(!PALETTE_KEYS.includes(key))stop(AUTHORITY_KEY.test(key)?'APPEARANCE_FIELD_NOT_ALLOWED':'APPEARANCE_FIELD_UNKNOWN',field);const v=o.palette.obj[key];if(v.kind!=='string')stop('APPEARANCE_FIELD_TYPE',field);if(!HEX6.test(v.value))stop('APPEARANCE_COLOR_INVALID',field);palette[key]=v.value.toLowerCase();}
      value.palette=Object.freeze(palette);}
    if(o.dashboardPreset){if(o.dashboardPreset.kind!=='string')stop('APPEARANCE_FIELD_TYPE','dashboardPreset');if(!APPEARANCE_PRESETS.includes(o.dashboardPreset.value))stop('APPEARANCE_PRESET_INVALID','dashboardPreset');value.dashboardPreset=o.dashboardPreset.value;}
    return Object.freeze({ok:true,value:Object.freeze(value)});
  }catch(error){if(error instanceof AppearanceInputError)return Object.freeze({ok:false,problem:appearanceProblem(error.code,APPEARANCE_FILE,error.field)});return Object.freeze({ok:false,problem:appearanceProblem('APPEARANCE_READ_FAILED')});}
}
export const appearanceImagePath=name=>`${APPEARANCE_ASSET_DIR}/${name}`;
// 꾸밈이 선택한 그림(최대 2개). [{kind,name,relative,type,max}]
export function selectedAppearanceImages(value){
  const out=[];for(const kind of ['icon','startPicture']){const name=value?.[kind];if(!name)continue;out.push(Object.freeze({kind,name,relative:appearanceImagePath(name),type:APPEARANCE_IMAGES[kind][name],max:APPEARANCE_LIMITS[kind]}));}return Object.freeze(out);
}

const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
const u32=(b,o)=>((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0,le32=(b,o)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0,ascii=(b,o,n)=>String.fromCharCode(...b.subarray(o,o+n));
// PNG: 서명·청크 CRC·IHDR 처음·IEND 마지막·IDAT 압축 해제 크기와 행 필터. icon 이면 포장 아이콘과 같은 256×256 규칙.
function png(bytes,{icon}){
  const signature=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];if(bytes.length<57||signature.some((v,i)=>bytes[i]!==v))return null;
  let offset=8,first=true,end=false,width=0,height=0,channels=0;const data=[];
  while(offset<bytes.length){if(offset+12>bytes.length)return null;const size=u32(bytes,offset),type=ascii(bytes,offset+4,4),next=offset+12+size;
    if(size>bytes.length||next>bytes.length||crc32(bytes.subarray(offset+4,next-4))!==u32(bytes,next-4))return null;
    if(first){if(type!=='IHDR'||size!==13)return null;width=u32(bytes,offset+8);height=u32(bytes,offset+12);const depth=bytes[offset+16],color=bytes[offset+17];
      if(depth!==8||![2,6].includes(color)||bytes[offset+18]!==0||bytes[offset+19]!==0||bytes[offset+20]!==0)return null;
      if(icon?width!==256||height!==256:width<1||height<1||width>APPEARANCE_LIMITS.dimension||height>APPEARANCE_LIMITS.dimension)return null;channels=color===6?4:3;first=false;}
    else if(type==='IHDR'||end)return null;
    if(type==='IDAT')data.push(bytes.subarray(offset+8,next-4));
    if(type==='IEND'){if(size!==0||next!==bytes.length||!data.length)return null;end=true;}
    offset=next;}
  if(!end)return null;
  const stream=Buffer.concat(data);if(stream.length<2||(stream[0]&0x0f)!==8||(stream[0]>>4)>7||((stream[0]<<8)|stream[1])%31!==0||(stream[1]&0x20))return null;
  // 아이콘(256×256)은 포장 아이콘처럼 끝까지 풀어 본다. 큰 시작 그림은 요청마다 풀지 않고 구조·zlib 머리만 확인한다.
  if(icon)try{const stride=width*channels+1,raw=inflateSync(stream,{maxOutputLength:stride*height});if(raw.length!==stride*height)return null;for(let row=0;row<height;row++)if(raw[row*stride]>4)return null;}catch{return null;}
  return {type:'image/png',width,height};
}
// WebP: RIFF 길이 정확·청크 전체 순회·첫 청크 VP8/VP8L/VP8X·정지 그림만(애니메이션 거절)·크기 4096 이하.
function webp(bytes){
  if(bytes.length<20||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WEBP'||le32(bytes,4)+8!==bytes.length)return null;
  let offset=12,width=0,height=0,first=null,image=false;
  while(offset<bytes.length){if(offset+8>bytes.length)return null;const type=ascii(bytes,offset,4),size=le32(bytes,offset+4),start=offset+8,next=start+size+(size&1);if(next>bytes.length)return null;
    if(first===null){first=type;
      if(type==='VP8 '){if(size<10||bytes[start+3]!==0x9d||bytes[start+4]!==0x01||bytes[start+5]!==0x2a)return null;width=(bytes[start+6]|(bytes[start+7]<<8))&0x3fff;height=(bytes[start+8]|(bytes[start+9]<<8))&0x3fff;image=true;}
      else if(type==='VP8L'){if(size<5||bytes[start]!==0x2f)return null;const b1=bytes[start+1],b2=bytes[start+2],b3=bytes[start+3],b4=bytes[start+4];width=1+(b1|((b2&0x3f)<<8));height=1+((b2>>6)|(b3<<2)|((b4&0x0f)<<10));image=true;}
      else if(type==='VP8X'){if(size<10||(bytes[start]&0x02))return null;width=1+(bytes[start+4]|(bytes[start+5]<<8)|(bytes[start+6]<<16));height=1+(bytes[start+7]|(bytes[start+8]<<8)|(bytes[start+9]<<16));}
      else return null;}
    else if(type==='ANIM'||type==='ANMF'||type==='VP8X')return null;
    else if(type==='VP8 '||type==='VP8L'){if(first!=='VP8X'||image)return null;image=true;}
    offset=next;}
  if(offset!==bytes.length||!image||width<1||height<1||width>APPEARANCE_LIMITS.dimension||height>APPEARANCE_LIMITS.dimension)return null;
  return {type:'image/webp',width,height};
}
// 확장자·고정 이름·실제 형식·byte 상한을 함께 확인한다. → {ok:true,type,width,height}|{ok:false,problem}
export function inspectAppearanceImage(kind,name,bytes){
  const file=Object.hasOwn(APPEARANCE_IMAGES,kind)&&Object.hasOwn(APPEARANCE_IMAGES[kind],name)?appearanceImagePath(name):APPEARANCE_FILE;
  if(file===APPEARANCE_FILE)return Object.freeze({ok:false,problem:appearanceProblem('APPEARANCE_IMAGE_NAME_INVALID',file,kind)});
  if(!(bytes instanceof Uint8Array))return Object.freeze({ok:false,problem:appearanceProblem('APPEARANCE_READ_FAILED',file,kind)});
  if(bytes.length>APPEARANCE_LIMITS[kind])return Object.freeze({ok:false,problem:appearanceProblem('APPEARANCE_IMAGE_TOO_LARGE',file,kind)});
  const expected=APPEARANCE_IMAGES[kind][name],found=expected==='image/png'?png(bytes,{icon:kind==='icon'}):webp(bytes);
  if(!found||found.type!==expected)return Object.freeze({ok:false,problem:appearanceProblem('APPEARANCE_IMAGE_FORMAT',file,kind)});
  return Object.freeze({ok:true,...found});
}

// 대비 보정(도구 가독성용 순수 계산. 통과 조건이 아니다). 바탕·표면은 흰색 쪽으로, 강조색은 검정 쪽으로 최소한만 섞는다.
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const toHex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
export const mixColor=(a,b,t)=>{const x=rgb(a),y=rgb(b);return toHex(x.map((v,i)=>v+(y[i]-v)*t));};
export function luminance(hex){const [r,g,b]=rgb(hex).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;}
export function contrastRatio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
const STEPS=Array.from({length:21},(_,i)=>i/20);
const readable=(back,fronts)=>fronts.every(f=>contrastRatio(back,f)>=APPEARANCE_MIN_CONTRAST);
function lighten(color,fronts){for(const t of STEPS){const c=mixColor(color,'#ffffff',t);if(readable(c,fronts))return c;}return '#ffffff';}
export function correctAppearancePalette(palette){
  const asked={...APPEARANCE_BASE_PALETTE,...(palette??{})},fixed=Object.values(APPEARANCE_FIXED_FOREGROUNDS);
  const background=lighten(asked.background,fixed),surface=lighten(asked.surface,fixed);
  let accent=asked.accent,accentSoft=mixColor(accent,surface,0.88);
  for(const t of STEPS){const a=mixColor(asked.accent,'#000000',t),soft=mixColor(a,surface,0.88);
    if(readable(a,['#ffffff',surface,background,soft])&&readable(soft,[APPEARANCE_FIXED_FOREGROUNDS.text])){accent=a;accentSoft=soft;break;}
    if(t===1){accent='#000000';accentSoft=soft;}}
  const corrected=[['accent',accent],['background',background],['surface',surface]].filter(([k,v])=>v!==asked[k]).map(([k])=>k);
  return Object.freeze({accent,accentSoft,background,surface,corrected:Object.freeze(corrected)});
}

// 화면으로 보내는 정규화 DTO. 상태: absent(파일 없음 — 기존 화면 그대로) / applied / invalid(짧은 안내 + 기존 화면).
export function appearanceView(read){
  const base={schema:APPEARANCE_VIEW_SCHEMA,state:'absent',appName:null,icon:null,startPicture:null,dashboardPreset:'default',palette:null,corrected:[],problem:null};
  if(!read||read.state==='absent')return Object.freeze(base);
  if(read.state!=='valid'||!read.value)return Object.freeze({...base,state:'invalid',problem:read.problem??appearanceProblem('APPEARANCE_READ_FAILED')});
  const v=read.value,palette=v.palette?correctAppearancePalette(v.palette):null;
  return Object.freeze({...base,state:'applied',appName:v.appName,icon:v.icon?'/'+appearanceImagePath(v.icon):null,startPicture:v.startPicture?'/'+appearanceImagePath(v.startPicture):null,dashboardPreset:v.dashboardPreset,
    palette:palette?Object.freeze({accent:palette.accent,accentSoft:palette.accentSoft,background:palette.background,surface:palette.surface}):null,corrected:palette?palette.corrected:[]});
}
// 같은 출처 고정 stylesheet. 검증·보정된 hex 4개 변수만 선언한다. 상태 의미 변수(allow/deny/challenge/unknown/focus/student)는 쓰지 않는다.
export function appearanceCss(view){
  const head='/* student/appearance.json 꾸밈: 검증된 색 변수만 선언합니다. 상태 색은 바꾸지 않습니다. */\n';
  const p=view?.state==='applied'?view.palette:null;if(!p)return head;
  for(const v of [p.accent,p.accentSoft,p.background,p.surface])if(!HEX6.test(v))return head;
  return `${head}:root{--accent:${p.accent};--accent-soft:${p.accentSoft};--bg:${p.background};--surface:${p.surface}}\n`;
}
