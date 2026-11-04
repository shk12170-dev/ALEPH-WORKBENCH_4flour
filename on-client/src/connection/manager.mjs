// Alekov 학생 AI 연결 관리자 — 서버 전용. 브라우저로 내보내지 않으며 HTTP 를 직접 열거나 mount 하지 않는다.
// root(Codex)가 POST /api/ai/connect/{start,finish,status,cancel} 경계에 아래 메서드를 연결한다.
// verifier·token·credential·private handle·기대 scope 는 이 프로세스 메모리와 native SDK·vault sink 안에만 있다.
// 공개 응답은 고정 필드만 새로 만들어 돌려준다. 자동 재시도·재발급·grant 회수는 하지 않는다.
import {createAlekovAppConnector,ALEPH_PORTAL_ORIGIN,connectStage,connectDetail,connectionErrorDetail} from '../ai/connection.mjs';
import {types} from 'node:util';
import {nativeOwn,nativePublicError} from './native-login.mjs';
import {isNativeHostContext,openNativeHostOperation,readNativeHostOperation,assertNativeHostOperation,assertNativeHostContinuity,createNativeOperationVault,closeNativeHostOperation} from './native-context.mjs';

export const CONNECTION_SCOPE_SCHEMA='aleph.on.ai-identity.v1';
export const PUBLIC_STATES=Object.freeze(['awaiting_approval','checking','connected','error','unknown','cancelled']);
const SCOPE=['schema','sourceSubjectId','canonicalStudentId','alephUserId','siteId','identityVersion','projectId','sessionId'];
const TERMINAL=new Set(['connected','error','unknown','cancelled']);
// 확정 실패: 자격이 생기지 않았다고 볼 수 있는 경우만 error. 나머지는 unknown(자동 회수·재시도 없음).
const DEFINITE=new Set(['ALEKOV_CONNECT_EXPIRED','ALEKOV_CONNECT_REJECTED','ALEKOV_CONNECT_UNAVAILABLE']);
export const MESSAGES=Object.freeze({
  ALEKOV_CONNECT_INPUT_INVALID:'요청 형식이 올바르지 않습니다. 화면을 다시 불러온 뒤 새로 시작하세요.',
  ALEKOV_CONNECT_UNAVAILABLE:'AI 연결 기능이 아직 준비되지 않았습니다. 기존 설명·판정·기록은 그대로 쓸 수 있습니다.',
  ALEKOV_CONNECT_CONTEXT_UNVERIFIED:'현재 로그인·프로젝트를 확인할 수 없습니다. 「상태 다시 확인」으로 결과를 확인한 뒤, 문의용 확인정보를 담당자에게 전달하세요.',
  ALEKOV_CONNECT_CONTEXT_CHANGED:'현재 로그인·프로젝트 확인을 계속할 수 없어 연결을 멈췄습니다. 확인 유효시간이 지났을 수도 있습니다. 「상태 다시 확인」으로 결과를 확인한 뒤, 문의용 확인정보를 담당자에게 전달하세요.',
  ALEKOV_CONNECT_NOT_FOUND:'연결 요청을 찾을 수 없습니다. 연결을 새로 시작하세요.',
  ALEKOV_CONNECT_BUSY:'진행 중인 연결 요청이 너무 많습니다. 기존 요청을 취소하거나 끝낸 뒤 다시 시작하세요.',
  ALEKOV_CONNECT_EXPIRED:'승인 기한이 지났습니다. 연결을 새로 시작하세요.',
  ALEKOV_CONNECT_REJECTED:'연결 요청이 거절됐습니다. 승인한 계정이 현재 로그인과 같은지 확인한 뒤 새로 시작하세요.',
  ALEKOV_CONNECT_OUTCOME_UNKNOWN:'연결 결과를 확인할 수 없습니다. 자동으로 다시 시도하지 않습니다. 담당자에게 확인을 요청하세요.',
  ALEKOV_CONNECT_DEADLINE:'현재 로그인 확인이나 서버 처리가 늦어 이 요청을 멈췄습니다. 자동으로 다시 시도하지 않습니다. 잠시 뒤 직접 다시 누르세요.',
  ALEKOV_CONNECT_STORAGE_UNVERIFIED:'연결 열쇠를 이 PC에 저장하지 못했거나 저장 여부를 확인하지 못했습니다. 「상태 다시 확인」을 누른 뒤, 계속 확인 불가로 나오면 문의용 확인정보를 담당자에게 전달하세요.',
  ALEKOV_CONNECT_RESPONSE_INVALID:'연결 서버의 응답을 확인하지 못했습니다. 「상태 다시 확인」을 누른 뒤, 계속 확인 불가로 나오면 문의용 확인정보를 담당자에게 전달하세요.',
  ALEKOV_CONNECT_TIMEOUT:'승인 확인이 시간 안에 끝나지 않았습니다. 「상태 다시 확인」으로 결과를 확인하세요. 계속 확인 불가로 나오면 담당자에게 문의하세요.',
  ALEKOV_CONNECT_CANCELLED:'연결 취소 요청을 받았습니다. 이미 승인했다면 연결이 남아 있을 수 있습니다. 「상태 다시 확인」으로 결과를 확인하세요.',
  ALEKOV_CONNECT_HANDLE_INVALID:'현재 연결 요청을 계속 진행할 수 없습니다. 「상태 다시 확인」으로 결과를 확인한 뒤 담당자에게 문의하세요.',
  ALEKOV_CONNECT_REDIRECT_BLOCKED:'승인 확인 중 허용되지 않은 주소로 이동하려는 응답을 받아 중단했습니다. 문의용 확인정보를 담당자에게 전달하세요.',
});
function diagnosticLine(event,phase,detailCode,started,code,failedStage){try{const elapsed=now()-started;if(!Number.isFinite(elapsed))return;
  console.error(JSON.stringify({event,phase,...(code?{code}:{}),detailCode:connectDetail(detailCode),...(connectStage(failedStage)?{failedStage:connectStage(failedStage)}:{}),elapsedMs:Math.max(0,Math.min(420000,Math.floor(elapsed)))}));}catch{}}
const flowView=f=>({connectionId:f.id,state:f.state,expiresAt:f.expiresAt,reason:f.reason});
// 10-26: 진단은 data 밖 diagnostic 키로만 싣는다. 기존 브라우저는 {ok,data} 의 data 4필드만 검사하므로 새 서버 응답도 그대로 받는다.
const flowDiagnostic=f=>({failedStage:connectStage(f.failedStage)??null,detailCode:f.detailCode==null?null:connectDetail(f.detailCode)});
const flowBody=f=>({ok:true,data:flowView(f),diagnostic:flowDiagnostic(f)});
function recordFailure(f,reason,detail,at){let stage;try{if(detail&&typeof detail==='object'&&!types.isProxy(detail)){const d=Object.getOwnPropertyDescriptor(detail,'failedStage');if(d&&Object.hasOwn(d,'value'))stage=connectStage(d.value);}}catch{}f.failedStage=at!==undefined?connectStage(at)??null:stage??connectStage(f.activeStage);f.detailCode=detail?connectionErrorDetail(detail):connectDetail(reason);}
// 기한·취소 경계. 늦게 끝난 원천 값은 버리고, 그 값으로 다음 단계를 시작하지 않는다.
const TIMEOUT=Symbol('timeout'),ABORTED=Symbol('aborted');
const now=()=>performance.now();
function within(work,ms,signal){
  if(signal?.aborted)return Promise.resolve(ABORTED);
  return new Promise(resolve=>{
    let done=false,timer;
    const onAbort=()=>finish(ABORTED);
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);resolve(value);};
    timer=setTimeout(()=>finish(TIMEOUT),Math.max(0,ms));
    signal?.addEventListener('abort',onAbort,{once:true});
    Promise.resolve().then(work).then(finish,()=>finish(null));
  });
}
const late=v=>v===TIMEOUT||v===ABORTED;
const REASONS=new Set(['ALEKOV_CONNECT_CONTEXT_UNVERIFIED','ALEKOV_CONNECT_CONTEXT_CHANGED','ALEKOV_CONNECT_CANCELLED','ALEKOV_CONNECT_UNAVAILABLE','ALEKOV_CONNECT_TIMEOUT',
  'ALEKOV_CONNECT_OUTCOME_UNKNOWN','ALEKOV_CONNECT_REDIRECT_BLOCKED','ALEKOV_CONNECT_REJECTED','ALEKOV_CONNECT_RESPONSE_INVALID','ALEKOV_CONNECT_HANDLE_INVALID',
  'ALEKOV_CONNECT_EXPIRED','ALEKOV_CONNECT_STORAGE_UNVERIFIED']);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(v);
const project=v=>id(v)&&v.length<=199&&!v.includes('..')&&!/^(?:[a-z]:|file:|sk-|sb_secret_|eyJ|bearer(?:$|[._:@-])|token(?:$|[._:@-]))/i.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const positive=v=>Number.isSafeInteger(v)&&v>0;
const bounded=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const validScope=v=>exact(v,SCOPE)&&v.schema===CONNECTION_SCOPE_SCHEMA&&positive(v.identityVersion)
  &&SCOPE.filter(k=>k!=='schema'&&k!=='identityVersion').every(k=>id(v[k]));
const sameScope=(a,b)=>!!a&&!!b&&SCOPE.every(k=>a[k]===b[k]);
const own=code=>Object.assign(new Error(code),{code});
const reply=(status,body)=>Object.freeze({status,body});
const failure=(status,code)=>reply(status,{ok:false,error:{code,message:MESSAGES[code]??MESSAGES.ALEKOV_CONNECT_OUTCOME_UNKNOWN}});
const startCode=code=>REASONS.has(code)&&MESSAGES[code]?code:'ALEKOV_CONNECT_OUTCOME_UNKNOWN';
const startStatus=code=>code==='ALEKOV_CONNECT_UNAVAILABLE'?503:code.startsWith('ALEKOV_CONNECT_CONTEXT_')?409:502;

/** 승인 URL 은 현재 고정 ALEPH origin 의 Workbench 전용 query 만 허용한다. */
export function isWorkbenchApprovalUrl(value,connectionId,projectId){
  let url;try{url=new URL(value);}catch{return false;}
  if(url.href!==value||url.origin!==ALEPH_PORTAL_ORIGIN||url.pathname!=='/workbench.html'||url.hash||url.username||url.password)return false;
  const keys=[...url.searchParams.keys()];
  if(url.searchParams.get('appConnect')!=='alekov'||url.searchParams.get('appDevice')!==connectionId||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('appChallenge')??''))return false;
  // Two-argument historical callers may validate exact3. A current native flow
  // supplies its trusted project and therefore requires the registration exact5.
  if(keys.join(',')==='appConnect,appDevice,appChallenge')return projectId===undefined;
  const expected=url.searchParams.get('appProject');
  return keys.join(',')==='appConnect,appDevice,appChallenge,appRegistration,appProject'&&url.searchParams.get('appRegistration')==='v1'
    &&project(expected)&&(projectId===undefined||project(projectId)&&expected===projectId);
}

/**
 * readServerScope: 호스트가 검증한 현재 scope(aleph.on.ai-identity.v1, 8필드)를 돌려주는 함수. 없으면 비활성.
 * vault.persistCredential: 비공개 sink. 결과(ack)는 SDK 와 이 관리자만 본다.
 * fetchImpl: 명시적 테스트 seam. gateway/portal origin 은 SDK 고정값을 그대로 쓴다.
 * 모든 메서드는 {status, body} 를 돌려주며 body 는 {ok:true,data} 또는 고정 {ok:false,error:{code,message}} 이다.
 */
export function createConnectionManager(options={}){
  if(!options||typeof options!=='object'||types.isProxy(options))throw Error('INVALID_SERVER_CONNECTION_CONFIGURATION');
  const d=Object.getOwnPropertyDescriptor(options,'nativeHost');
  if(d){if(!Object.hasOwn(d,'value')||!d.enumerable||!isNativeHostContext(d.value))throw Error('INVALID_SERVER_CONNECTION_CONFIGURATION');return createNativeManager(options,d.value);}
  for(let p=Object.getPrototypeOf(options);p;p=Object.getPrototypeOf(p)){if(types.isProxy(p)||Object.getOwnPropertyDescriptor(p,'nativeHost'))throw Error('INVALID_SERVER_CONNECTION_CONFIGURATION');}
  const {enabled=false,readServerScope,vault,fetchImpl=globalThis.fetch,clock=Date.now,
    startTimeoutMs=15000,scopeTimeoutMs=5000,finishTimeoutMs=420000,pollIntervalMs=2000,maxFlows=8,retainMs=600000}=options;
  const configured=enabled===true&&typeof readServerScope==='function'&&typeof vault?.persistCredential==='function'&&typeof fetchImpl==='function'
    &&typeof clock==='function'&&bounded(startTimeoutMs,1,60000)&&bounded(scopeTimeoutMs,1,60000)&&bounded(finishTimeoutMs,1,420000)&&bounded(pollIntervalMs,1,10000)
    &&bounded(maxFlows,1,32)&&bounded(retainMs,1,3600000);
  const persist=configured?vault.persistCredential.bind(vault):null;
  // 동시 연결 흐름 상한(메모리 보호). 운영 AI 사용 횟수 제한이 아니다.
  const flows=new Map();let starting=0;

  // 호스트가 검증한 현재 scope 만 읽는다. body·URL·env·학생 hook 값으로 신원을 만들지 않는다.
  async function readScopeResult(){try{const v=structuredClone(await readServerScope());return {scope:validScope(v)?Object.freeze(v):null,detailCode:'ALEKOV_CONNECT_CONTEXT_UNVERIFIED'};}catch(error){return {scope:null,detailCode:connectionErrorDetail(error)};}}
  async function readScope(){return (await readScopeResult()).scope;}
  const view=flowView;
  function settle(flow,state,reason=null,detail,at){
    if(TERMINAL.has(flow.state))return;
    if(reason){recordFailure(flow,reason,detail,at);diagnosticLine('alekov_connect_diagnostic',flow.failedStage??'handleValidate',flow.detailCode,flow.startedAt??now());}
    const controller=flow.controller;flow.controller=null;
    flow.state=state;flow.reason=reason;flow.settledAt=clock();flow.handle=null;flow.connector=null;
    clearTimeout(flow.timer);flow.timer=null;controller?.abort();
  }
  function prune(){
    const now=clock();
    for(const [key,flow] of flows){
      if(flow.state==='awaiting_approval'&&now>=flow.expiresMs)settle(flow,'error','ALEKOV_CONNECT_EXPIRED');
      if(TERMINAL.has(flow.state)&&now-flow.settledAt>=retainMs)flows.delete(key);
    }
  }
  function capacity(){
    prune();
    if(flows.size+starting<maxFlows)return true;
    const done=[...flows].filter(([,f])=>TERMINAL.has(f.state)).sort((a,b)=>a[1].settledAt-b[1].settledAt);
    for(const [key] of done){flows.delete(key);if(flows.size+starting<maxFlows)return true;}
    return false;
  }
  // 계정·프로젝트·세션·신원 버전 전환: 진행을 멈추고 옛 결과를 정상으로 표시하지 않는다.
  function interrupt(flow,code,detail,at){if(flow.state==='awaiting_approval')settle(flow,'cancelled',code,detail,at);else if(flow.state==='checking')settle(flow,'unknown',code,detail,at);}
  // 요청 signal 은 조회 대기만 끝낸다. 원천이 끝나지 않거나 늦으면 흐름을 바꾸지 않고 고정 504.
  async function locate(input,signal){
    if(!exact(input,['connectionId'])||!uuid(input.connectionId))return {reply:failure(400,'ALEKOV_CONNECT_INPUT_INVALID')};
    if(!configured)return {reply:failure(503,'ALEKOV_CONNECT_UNAVAILABLE')};
    prune();
    const flow=flows.get(input.connectionId);if(!flow)return {reply:failure(404,'ALEKOV_CONNECT_NOT_FOUND')};
    const observed=await within(readScopeResult,scopeTimeoutMs,signal);
    if(late(observed))return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};
    const scope=observed?.scope;
    if(!sameScope(scope,flow.scope)){
      const code=scope?'ALEKOV_CONNECT_CONTEXT_CHANGED':'ALEKOV_CONNECT_CONTEXT_UNVERIFIED';
      interrupt(flow,code,scope?undefined:{detailCode:connectDetail(observed?.detailCode)},'requestContext');return {reply:failure(409,code)};
    }
    if(flow.state==='awaiting_approval'&&clock()>=flow.expiresMs)settle(flow,'error','ALEKOV_CONNECT_EXPIRED');
    return {flow};
  }

  // 기한은 최초 신원 조회 전부터 시작해 SDK 시작과 마지막 scope 재조회까지 같은 단조 시계로 잰다.
  // 선택 인자 {signal}(root HTTP mount 의 요청 수명)은 접수 준비만 끝낸다.
  // 기한·취소 뒤 늦게 끝난 원천 값으로 SDK begin·fetch·vault 저장을 시작하지 않고, 시작 슬롯은 항상 돌려준다.
  async function start(input,{signal}={}){
    if(!exact(input,[]))return failure(400,'ALEKOV_CONNECT_INPUT_INVALID');
    if(!configured)return failure(503,'ALEKOV_CONNECT_UNAVAILABLE');
    if(!capacity())return failure(429,'ALEKOV_CONNECT_BUSY');
    starting++;
    const deadline=now()+startTimeoutMs,controller=new AbortController(),left=()=>deadline-now(),stop=()=>controller.abort();
    const timer=setTimeout(stop,startTimeoutMs);
    if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
    const expired=()=>failure(504,'ALEKOV_CONNECT_DEADLINE');
    try{
      const scope=await within(readScope,left(),controller.signal);
      if(late(scope)||controller.signal.aborted)return expired();
      if(!scope)return failure(409,'ALEKOV_CONNECT_CONTEXT_UNVERIFIED');
      const flow={id:null,scope,state:'starting',reason:null,expiresAt:null,expiresMs:0,handle:null,connector:null,controller:null,timer:null,settledAt:0,vaultAck:false,activeStage:null,failedStage:null,detailCode:null,startedAt:now()};
      flow.connector=createAlekovAppConnector({enabled:true,fetchImpl,clock,timeoutMs:finishTimeoutMs,pollIntervalMs,
        // SDK 가 5필드 context 를 받기 전에 원래 8필드 scope 와 현재 scope 를 비교한다. 조회는 scopeTimeoutMs 안에서만 기다린다.
        resolveCurrentContext:async()=>{
          const observed=await within(readScopeResult,scopeTimeoutMs,(flow.controller??controller).signal),current=observed?.scope;
          if(observed===ABORTED)throw own('ALEKOV_CONNECT_CANCELLED');
          if(!current)throw Object.assign(own('ALEKOV_CONNECT_CONTEXT_UNVERIFIED'),{detailCode:observed===TIMEOUT?'ALEKOV_CONNECT_TIMEOUT':connectDetail(observed?.detailCode)});
          if(!sameScope(current,scope))throw own('ALEKOV_CONNECT_CONTEXT_CHANGED');
          return {subjectId:current.canonicalStudentId,alephUserId:current.alephUserId,siteId:current.siteId,identityVersion:current.identityVersion,projectId:current.projectId};
        },
        // 비공개 sink. 결과를 공개 응답에 싣지 않는다. 취소·전환 뒤에는 저장을 시작하지 않는다.
        persistCredential:async(value,options)=>{
          if(flow.state!=='checking'||!flow.controller)throw own('ALEKOV_CONNECT_CANCELLED');
          const saved=await persist(value,options);
          flow.vaultAck=exact(saved,['connectionId','credentialFingerprint','contextFingerprint','persisted'])&&saved.connectionId===flow.id&&saved.persisted===true;
          return saved;
        }});
      if(controller.signal.aborted)return expired();
      const begun=await within(()=>flow.connector.begin({signal:controller.signal}),left(),controller.signal);
      if(late(begun)||controller.signal.aborted)return expired();
      if(begun?.ok!==true){const code=startCode(begun?.error?.code);return failure(startStatus(code),code);}
      const c=begun.connection;
      if(!exact(c,['deviceId','approvalUrl','confirmation','expiresAt','state'])||!uuid(c.deviceId)||c.state!=='pending'||!iso(c.expiresAt)||Date.parse(c.expiresAt)<=clock()
        ||!/^[0-9a-f]{4}-[0-9a-f]{4}$/.test(c.confirmation)||!isWorkbenchApprovalUrl(c.approvalUrl,c.deviceId,scope.projectId)||flows.has(c.deviceId))return failure(502,'ALEKOV_CONNECT_OUTCOME_UNKNOWN');
      const after=await within(readScope,left(),controller.signal);
      if(late(after)||controller.signal.aborted)return expired();
      if(!sameScope(after,scope))return failure(409,after?'ALEKOV_CONNECT_CONTEXT_CHANGED':'ALEKOV_CONNECT_CONTEXT_UNVERIFIED');
      Object.assign(flow,{id:c.deviceId,state:'awaiting_approval',expiresAt:c.expiresAt,expiresMs:Date.parse(c.expiresAt),handle:begun.handle});
      flows.set(flow.id,flow);
      return reply(201,{ok:true,data:{connectionId:flow.id,approvalUrl:c.approvalUrl,confirmation:c.confirmation,expiresAt:c.expiresAt,state:'awaiting_approval'}});
    }finally{starting--;clearTimeout(timer);signal?.removeEventListener('abort',stop);controller.abort();}
  }

  // 학생의 브라우저 로그인 시간을 HTTP 요청 수명에 묶지 않는다: 짧은 비공개 job 을 띄우고 바로 202/checking.
  // 요청 signal 은 접수 준비(scope 조회)까지만 쓴다. job 은 별도 controller·기한·scope 검사로만 멈추며
  // 202 를 돌려준 뒤 HTTP 응답이 닫혀도 취소되지 않는다.
  async function finish(input,{signal}={}){
    const found=await locate(input,signal);if(found.reply)return found.reply;
    const flow=found.flow;
    if(flow.state!=='awaiting_approval')return reply(flow.state==='checking'?202:200,flowBody(flow));
    if(signal?.aborted)return failure(504,'ALEKOV_CONNECT_DEADLINE');
    const controller=new AbortController(),handle=flow.handle,connector=flow.connector;
    flow.state='checking';flow.controller=controller;flow.handle=null;flow.activeStage='handleValidate';flow.startedAt=now();
    flow.timer=setTimeout(()=>settle(flow,'unknown','ALEKOV_CONNECT_TIMEOUT'),finishTimeoutMs);
    (async()=>{
      let result;try{result=await connector.complete(handle,{signal:controller.signal,onStage:stage=>{if(flow.state==='checking')flow.activeStage=connectStage(stage);}});}catch(error){result={error:{detailCode:connectionErrorDetail(error)}};}
      if(flow.controller!==controller||flow.state!=='checking')return; // 취소·전환·시간 초과가 먼저 확정됐다.
      const c=result?.ok===true?result.connection:null;
      if(c&&c.state==='connected'&&c.appId==='aleph-on'&&c.audience==='on-client'&&c.workbenchRequiredAtRuntime===false&&flow.vaultAck===true){
        flow.activeStage='finalContext';const observed=await within(readScopeResult,scopeTimeoutMs,controller.signal),current=observed?.scope;
        if(flow.controller!==controller||flow.state!=='checking')return;
        if(!current)return settle(flow,'unknown','ALEKOV_CONNECT_CONTEXT_UNVERIFIED',{detailCode:observed===TIMEOUT?'ALEKOV_CONNECT_TIMEOUT':observed===ABORTED?'ALEKOV_CONNECT_CANCELLED':connectDetail(observed?.detailCode)});
        return sameScope(current,flow.scope)?settle(flow,'connected'):settle(flow,'unknown','ALEKOV_CONNECT_CONTEXT_CHANGED');
      }
      const code=REASONS.has(result?.error?.code)?result.error.code:c?'ALEKOV_CONNECT_STORAGE_UNVERIFIED':'ALEKOV_CONNECT_OUTCOME_UNKNOWN';
      settle(flow,DEFINITE.has(code)?'error':'unknown',code,result?.error);
    })().catch(()=>{if(flow.controller===controller)settle(flow,'unknown','ALEKOV_CONNECT_OUTCOME_UNKNOWN');});
    return reply(202,flowBody(flow));
  }

  async function status(input,{signal}={}){
    const found=await locate(input,signal);if(found.reply)return found.reply;
    return reply(200,flowBody(found.flow));
  }

  // 취소: 승인 대기면 cancelled. 확인 중이면 이미 생겼을 수 있는 grant 를 지우거나 회수하지 않고 unknown.
  async function cancel(input,{signal}={}){
    const found=await locate(input,signal);if(found.reply)return found.reply;
    const flow=found.flow;
    if(flow.state==='awaiting_approval')settle(flow,'cancelled','ALEKOV_CONNECT_CANCELLED');
    else if(flow.state==='checking')settle(flow,'unknown','ALEKOV_CONNECT_CANCELLED');
    return reply(200,flowBody(flow));
  }

  function close(){for(const flow of flows.values())interrupt(flow,'ALEKOV_CONNECT_CANCELLED');flows.clear();}

  return Object.freeze({available:configured,start,finish,status,cancel,close});
}

// native host5를 engine scope8로 바꾸지 않는다. 모든 callback은 시작 때의 원 operation을 사용한다.
// 브라우저 시작 응답은 내부 flow view 보다 좁은 고정 계약이다.
// reason 과 native capability/connector 상태는 서버 안에만 둔다.
export function nativeStartPublicData(flow,connection){
  return {connectionId:flow.id,approvalUrl:connection.approvalUrl,confirmation:connection.confirmation,expiresAt:flow.expiresAt,state:flow.state};
}

function createNativeManager(raw,host){
  const config=nativeOwn(raw,['nativeHost'],['enabled','fetchImpl','clock','startTimeoutMs','finishTimeoutMs','pollIntervalMs','maxFlows','retainMs']);
  const fetchImpl=config.fetchImpl??globalThis.fetch,clock=config.clock??Date.now,startTimeoutMs=config.startTimeoutMs??15000,finishTimeoutMs=config.finishTimeoutMs??420000,pollIntervalMs=config.pollIntervalMs??2000,maxFlows=config.maxFlows??8,retainMs=config.retainMs??600000;
  if(config.enabled!==true||typeof fetchImpl!=='function'||types.isProxy(fetchImpl)||typeof clock!=='function'||types.isProxy(clock)||!bounded(startTimeoutMs,1,60000)||!bounded(finishTimeoutMs,1,420000)||!bounded(pollIntervalMs,1,10000)||!bounded(maxFlows,1,32)||!bounded(retainMs,1,3600000))throw Error('INVALID_SERVER_CONNECTION_CONFIGURATION');
  const flows=new Map();let closed=false,starting=0;
  const nativeCodes=['INPUT_INVALID','DISABLED','CANCELLED','EXPIRED','TIMEOUT','RESPONSE_INVALID','CONTEXT_CHANGED','UNVERIFIED','OUTCOME_UNKNOWN','BUSY'].map(v=>'NATIVE_HOST_'+v);
  const phases=['locateTimeout','locateCancelled','locateCurrent','locateAssert','connectedCurrent','complete','completeCurrent','startOpen','startCurrent','startBegin'];
  function diagnostic(phase,code,started,detailCode=code,failedStage){if(!phases.includes(phase)||!nativeCodes.includes(code)&&!REASONS.has(code))return;diagnosticLine('alekov_native_connect_diagnostic','nativeConnect.'+phase,detailCode,started,code,failedStage);}
  const currentReason=code=>code==='NATIVE_HOST_CONTEXT_CHANGED'?'ALEKOV_CONNECT_CONTEXT_CHANGED':'ALEKOV_CONNECT_CONTEXT_UNVERIFIED';
  function connectorReason(result){try{if(!result||typeof result!=='object'||types.isProxy(result))return 'ALEKOV_CONNECT_OUTCOME_UNKNOWN';const e=Object.getOwnPropertyDescriptor(result,'error');if(!e||!Object.hasOwn(e,'value')||!e.value||typeof e.value!=='object'||types.isProxy(e.value))return 'ALEKOV_CONNECT_OUTCOME_UNKNOWN';const c=Object.getOwnPropertyDescriptor(e.value,'code');return c&&Object.hasOwn(c,'value')&&REASONS.has(c.value)?c.value:'ALEKOV_CONNECT_OUTCOME_UNKNOWN';}catch{return 'ALEKOV_CONNECT_OUTCOME_UNKNOWN';}}
  const view=flowView;
  function settle(f,status,reason=null,detail,logged=false,at){if(TERMINAL.has(f.state))return;if(reason){recordFailure(f,reason,detail,at);if(!logged)diagnostic('complete',reason,f.startedAt??now(),f.detailCode,f.failedStage);}f.state=status;f.reason=reason;f.settledAt=clock();clearTimeout(f.timer);f.controller.abort();closeNativeHostOperation(f.cap);f.connector=null;f.handle=null;}
  function prune(){for(const [key,f] of flows){if(f.state==='awaiting_approval'&&clock()>=Date.parse(f.expiresAt))settle(f,'error','ALEKOV_CONNECT_EXPIRED');if(TERMINAL.has(f.state)&&clock()-f.settledAt>=retainMs)flows.delete(key);}}
  async function connectedCurrent(f,signal,started){
    const remaining=Math.floor(5000-(now()-started));
    if(remaining<=0||signal?.aborted)return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};
    let current;try{current=await openNativeHostOperation(host,{signal,timeoutMs:remaining});if(signal?.aborted||now()-started>=5000)return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};assertNativeHostContinuity(host,f.cap,current);if(signal?.aborted||now()-started>=5000)return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};}
    catch(error){const code=nativePublicError(error);diagnostic('connectedCurrent',code,started,connectionErrorDetail(error),'requestContext');if(signal?.aborted||now()-started>=5000||code==='NATIVE_HOST_TIMEOUT'||code==='NATIVE_HOST_CANCELLED')return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};const reason=currentReason(code);recordFailure(f,reason,error,'requestContext');f.state='unknown';f.reason=reason;f.settledAt=clock();return {reply:failure(409,reason)};}
    finally{closeNativeHostOperation(current);}
    return {flow:f};
  }
  async function locate(input,signal){if(!exact(input,['connectionId'])||!uuid(input.connectionId))return {reply:failure(400,'ALEKOV_CONNECT_INPUT_INVALID')};if(closed)return {reply:failure(503,'ALEKOV_CONNECT_UNAVAILABLE')};prune();const f=flows.get(input.connectionId);if(!f)return {reply:failure(404,'ALEKOV_CONNECT_NOT_FOUND')};
    const started=now();
    if(f.state==='connected')return connectedCurrent(f,signal,started);
    else if(!TERMINAL.has(f.state)){
      const observed=await within(async()=>{try{return {current:await readNativeHostOperation(host,f.cap)};}catch(error){return {code:nativePublicError(error),detailCode:connectionErrorDetail(error)};}},5000,signal);
      // 대기 중 complete·취소·만료가 확정됐다면, 그때 닫힌 cap의 후행 오류로 원래 결과를 가리지 않는다.
      // connected는 이 지름길에 포함하지 않는다. 현재 로그인 검사는 그대로 필요하다.
      if(TERMINAL.has(f.state)&&f.state!=='connected')return {flow:f};
      if(f.state==='connected')return connectedCurrent(f,signal,started);
      if(late(observed)||signal?.aborted){diagnostic(observed===TIMEOUT?'locateTimeout':'locateCancelled',observed===TIMEOUT?'ALEKOV_CONNECT_TIMEOUT':'ALEKOV_CONNECT_CANCELLED',started);return {reply:failure(504,'ALEKOV_CONNECT_DEADLINE')};}
      if(!observed?.current){const code=observed?.code??'NATIVE_HOST_UNVERIFIED',reason=currentReason(code);diagnostic('locateCurrent',code,started,observed?.detailCode,'requestContext');settle(f,'unknown',reason,{detailCode:observed?.detailCode},true,'requestContext');return {reply:failure(409,reason)};}
      try{assertNativeHostOperation(host,f.cap);}catch(error){const code=nativePublicError(error),reason=currentReason(code);diagnostic('locateAssert',code,started,connectionErrorDetail(error),'requestContext');settle(f,'unknown',reason,error,true,'requestContext');return {reply:failure(409,reason)};}
    }return {flow:f};}
  async function start(input,{signal}={}){
    if(!exact(input,[]))return failure(400,'ALEKOV_CONNECT_INPUT_INVALID');if(closed)return failure(503,'ALEKOV_CONNECT_UNAVAILABLE');prune();if(flows.size+starting>=maxFlows)return failure(429,'ALEKOV_CONNECT_BUSY');starting++;
    const controller=new AbortController();let cap,flow,timer;const stop=()=>controller.abort();if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,startTimeoutMs);
    const started=now();let phase='startOpen';
    try{
      // operation 자체는 독립 flow controller에 결속한다. begin HTTP 수명이 끝나도 finish가 같은 capability를 쓴다.
      cap=await openNativeHostOperation(host,{signal:controller.signal,timeoutMs:finishTimeoutMs});phase='startCurrent';const context=await readNativeHostOperation(host,cap),vault=createNativeOperationVault(host,cap,stage=>{if(flow?.state==='checking')flow.activeStage=connectStage(stage);});
      const connector=createAlekovAppConnector({enabled:true,fetchImpl,clock,timeoutMs:finishTimeoutMs,pollIntervalMs,
        resolveCurrentContext:()=>readNativeHostOperation(host,cap),persistCredential:async(input,call)=>{if(!flow||flow.state!=='checking'||flow.controller!==controller)throw Error('ALEKOV_CONNECT_CONTEXT_CHANGED');const ack=await vault.persistCredential(input,call);assertNativeHostOperation(host,cap);flow.vaultAck=ack.persisted===true;return ack;}});
      phase='startBegin';const result=await connector.begin({signal:controller.signal});assertNativeHostOperation(host,cap);
      if(!result?.ok||!result.connection||!isWorkbenchApprovalUrl(result.connection.approvalUrl,result.connection.deviceId,context.projectId))throw Error('ALEKOV_CONNECT_OUTCOME_UNKNOWN');
      flow={id:result.connection.deviceId,expiresAt:result.connection.expiresAt,state:'awaiting_approval',reason:null,cap,controller,connector,handle:result.handle,vaultAck:false,timer:null,activeStage:null,failedStage:null,detailCode:null,startedAt:now()};flows.set(flow.id,flow);
      flow.timer=setTimeout(()=>settle(flow,'unknown','ALEKOV_CONNECT_TIMEOUT'),finishTimeoutMs);return reply(201,{ok:true,data:nativeStartPublicData(flow,result.connection)});
    }catch(error){diagnostic(phase,nativePublicError(error),started,connectionErrorDetail(error));controller.abort();closeNativeHostOperation(cap);return failure(409,'ALEKOV_CONNECT_CONTEXT_UNVERIFIED');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);starting--;}
  }
  async function finish(input,{signal}={}){const located=await locate(input,signal);if(located.reply)return located.reply;const f=located.flow;if(f.state!=='awaiting_approval')return reply(200,flowBody(f));if(signal?.aborted)return failure(504,'ALEKOV_CONNECT_DEADLINE');f.state='checking';
    f.activeStage='handleValidate';f.startedAt=now();const controller=f.controller,connector=f.connector,handle=f.handle,started=f.startedAt;
    const pending=(async()=>{let phase='complete';try{const result=await connector.complete(handle,{signal:controller.signal,onStage:stage=>{if(f.state==='checking')f.activeStage=connectStage(stage);}});if(f.state!=='checking'||f.controller!==controller)return;if(result?.ok!==true||!f.vaultAck){const code=connectorReason(result);settle(f,'unknown',code,result?.error);return;}phase='completeCurrent';f.activeStage='finalContext';await readNativeHostOperation(host,f.cap);if(f.state!=='checking'||f.controller!==controller)return;assertNativeHostOperation(host,f.cap);settle(f,'connected');}catch(error){if(f.state==='checking'&&f.controller===controller){const code=nativePublicError(error);settle(f,'unknown',currentReason(code),error);}}})();pending.catch(()=>{});return reply(202,flowBody(f));}
  return Object.freeze({available:true,start,finish,async status(input,{signal}={}){const v=await locate(input,signal);return v.reply??reply(200,flowBody(v.flow));},async cancel(input,{signal}={}){const v=await locate(input,signal);if(v.reply)return v.reply;settle(v.flow,v.flow.state==='checking'?'unknown':'cancelled','ALEKOV_CONNECT_CANCELLED');return reply(200,flowBody(v.flow));},close(){closed=true;for(const f of flows.values())settle(f,'unknown','ALEKOV_CONNECT_CANCELLED');flows.clear();}});
}
