// 10일차(학생 추가): 이 앱이 스스로를 점검하는 사례별 실측입니다(동료가 공유한 총공세 길라잡이 02장 방식).
// 이 서버 자신(127.0.0.1)에만 GET 요청을 보냅니다. 외부 서비스·다른 사람의 앱에는 보내지 않고, 쓰기 요청도 보내지 않습니다.
// 행마다 결과(match·mismatch·unverified·not_run)를 두고 합계는 행에서 셉니다. not_run 과 unverified 는 일치 합계에 넣지 않습니다.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const REQUEST_TIMEOUT_MS=12000;
const SHA=/^[0-9a-f]{40}$/;
const RESULTS=['match','mismatch','unverified','not_run'];

// 실행하지 않는 사례는 계획과 섞지 않도록 따로 두고, 이유를 함께 적습니다.
export const NOT_RUN_CASES=Object.freeze([
  {id:'N-01',area:'SDP 실제 연결',reason:'이번 과정에서는 학생용 SDP 연결 설정 파일을 발급하지 않습니다(학습 도우미 안내).'},
  {id:'N-02',area:'이 앱의 계정·AI 연결',reason:'연결 시작은 쓰기 요청이라 자동 점검에서 보내지 않습니다. 이 앱은 연결 설정 없이 실행 중입니다.'},
  {id:'N-03',area:'AI 사건 설명·조치 집행',reason:'연결이 없고, 조치는 쓰기 요청이라 보내지 않습니다.'},
  {id:'N-04',area:'서버 중단 시 이전 값 제거',reason:'서버를 끄는 시험은 자동 점검 안에서 할 수 없습니다. 점검 기록 화면은 2026-11-03에 서버를 끄고 직접 확인했고, 6칸·내 PC 점검 화면은 모의 점검으로만 확인했습니다.'},
  {id:'N-05',area:'권한 부족 항목 표시',reason:'이 PC에서는 모든 항목이 일반 권한으로 읽혀 재현할 수 없습니다. 모의 점검으로만 확인했습니다.'},
].map(Object.freeze));

const okCount=(data,keys)=>keys.filter(k=>data?.[k]?.status==='ok').length;
const connItems=d=>[d?.network,d?.firewall,d?.events?.system,d?.events?.application];

// 엔진 모드에 따라 기대가 달라지는 본인 자료 API 다섯 개입니다. 연결 없음 모드의 503은 연결 성공이 아닙니다.
const ENGINE_APIS=[['C-05','me','로그인 정보'],['C-06','apps','업무 앱'],['C-07','events','보안 기록'],['C-08','devices','기기'],['C-09','sessions','세션']];

export function planCases(mode){
  const engineCases=ENGINE_APIS.map(([id,name,label])=>mode==='disconnected'
    ?{id,area:`${label} /api/${name}`,path:`/api/${name}`,expect:'503 ENGINE_NOT_CONNECTED(연결 없음 모드에서 정상)',
      check:r=>r.status===503&&r.body?.error?.code==='ENGINE_NOT_CONNECTED',observe:r=>`${r.status} ${r.body?.error?.code??''}`.trim(),note:'연결 성공이 아닙니다.'}
    :{id,area:`${label} /api/${name}`,path:`/api/${name}`,expect:'200',check:r=>r.status===200&&r.body?.ok===true,observe:r=>`${r.status}`,note:mode==='demo'?'예제 자료입니다.':''});
  return [
    {id:'C-01',area:'첫 화면 /',path:'/',expect:'200',check:r=>r.status===200,observe:r=>`${r.status}`},
    {id:'C-02',area:'내 PC 점검 화면 /pc',path:'/pc',expect:'200',check:r=>r.status===200,observe:r=>`${r.status}`},
    {id:'C-03',area:'PC 자원 /api/pc-status',path:'/api/pc-status',expect:'200, CPU·메모리·디스크 3/3 ok',
      check:r=>r.status===200&&okCount(r.body?.data,['cpu','memory','disk'])===3,observe:r=>`${r.status}, ${okCount(r.body?.data,['cpu','memory','disk'])}/3 ok`},
    {id:'C-04',area:'연결·기록 /api/pc-connection',path:'/api/pc-connection',expect:'200, 네 항목 4/4 ok, SDP 칸 따로',
      check:r=>r.status===200&&connItems(r.body?.data).every(i=>i?.status==='ok')&&typeof r.body?.data?.sdp?.label==='string',
      observe:r=>`${r.status}, ${connItems(r.body?.data).filter(i=>i?.status==='ok').length}/4 ok, SDP ${r.body?.data?.sdp?.label??'없음'}`},
    ...engineCases,
    {id:'C-10',area:'도움정보 /api/diagnostics',path:'/api/diagnostics',expect:`200, 모드 ${mode}`,
      check:r=>r.status===200&&r.body?.data?.engine?.mode===mode,observe:r=>`${r.status}, 모드 ${r.body?.data?.engine?.mode??'없음'}, ${r.body?.data?.engine?.code??''}`.trim()},
    {id:'C-11',area:'OSV /api/vulnerabilities',path:'/api/vulnerabilities',expect:'200, 조회 상태가 정해진 값 중 하나',
      check:r=>r.status===200&&['not_configured','not_checked','unverifiable','complete','partial'].includes(r.body?.data?.status),
      observe:r=>`${r.status}, ${r.body?.data?.status??'없음'} ${r.body?.data?.code??''}`.trim(),
      noteFor:r=>['not_configured','not_checked'].includes(r.body?.data?.status)?'미조회입니다. 「취약점 없음」으로 세지 않습니다.':''},
  ];
}

export function summarize(rows){
  const count=result=>rows.filter(r=>r.result===result).length;
  const summary={total:rows.length,match:count('match'),mismatch:count('mismatch'),unverified:count('unverified'),notRun:count('not_run')};
  if(summary.match+summary.mismatch+summary.unverified+summary.notRun!==summary.total)throw new Error('CHECK_RESULT_UNKNOWN');
  return summary;
}

// git 명령을 쓰지 않고 .git 의 HEAD 파일만 읽습니다. 커밋하지 않은 변경이 있는지는 확인하지 않습니다.
export async function readCommit(root){
  try{
    const head=(await readFile(resolve(root,'.git','HEAD'),'utf8')).trim();
    if(SHA.test(head))return head;
    const ref=head.match(/^ref: (refs\/[A-Za-z0-9._/-]+)$/)?.[1];
    if(!ref||ref.split('/').includes('..'))return null;
    try{const sha=(await readFile(resolve(root,'.git',...ref.split('/')),'utf8')).trim();if(SHA.test(sha))return sha;}catch{}
    const packed=await readFile(resolve(root,'.git','packed-refs'),'utf8');
    const sha=packed.split(/\r?\n/).find(line=>line.endsWith(` ${ref}`))?.split(' ')[0];
    return sha&&SHA.test(sha)?sha:null;
  }catch{return null;}
}

export function createChecksService({root,clock=()=>new Date(),fetchImpl=(...args)=>globalThis.fetch(...args)}){
  let running=false;
  async function get(base,path){
    try{
      const response=await fetchImpl(`${base}${path}`,{method:'GET',headers:{accept:'application/json'},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
      const raw=await response.text();
      let body=null;try{body=JSON.parse(raw);}catch{}
      return {status:response.status,body};
    }catch(error){
      return {error:error?.name==='TimeoutError'||error?.name==='AbortError'?'시간 초과로 응답을 받지 못했습니다.':'요청을 보내지 못했습니다.'};
    }
  }
  return {
    get running(){return running;},
    async run({port,mode}){
      if(running)return null;
      running=true;
      try{
        const base=`http://127.0.0.1:${port}`;
        const startedAt=clock().toISOString();
        const cases=planCases(mode);
        const responses=await Promise.all(cases.map(c=>get(base,c.path)));
        const executed=cases.map((c,i)=>{
          const r=responses[i];
          if(r.error)return {id:c.id,area:c.area,expect:c.expect,observed:`확인 불가: ${r.error}`,result:'unverified',source:'http',note:'응답을 받지 못해 일치·불일치를 판단하지 않습니다.'};
          const match=c.check(r);
          return {id:c.id,area:c.area,expect:c.expect,observed:c.observe(r),result:match?'match':'mismatch',source:'http',note:(c.noteFor?.(r)??c.note??'')};
        });
        const notRun=NOT_RUN_CASES.map(c=>({id:c.id,area:c.area,result:'not_run',source:'not_run',reason:c.reason}));
        const summary=summarize([...executed,...notRun]);
        return {schema:'student.checks.v1',startedAt,finishedAt:clock().toISOString(),target:`127.0.0.1:${port}(이 PC의 로컬 서버)`,mode,method:'GET만',
          commit:await readCommit(root),commitNote:'.git 의 HEAD 를 읽은 값입니다. 커밋하지 않은 변경이 있는지는 확인하지 않습니다.',
          executed,notRun,summary,resultKinds:RESULTS};
      }finally{running=false;}
    },
  };
}
