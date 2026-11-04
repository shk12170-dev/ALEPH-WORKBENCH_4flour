// Native/app-server connection only. Reuses the Workbench challenge/approval
// experience, never its saved credential or its runtime as an AI relay.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {types} from 'node:util';

// 진단 값은 이 고정 목록만 통과한다. 접두어 일치나 예외 원문은 허용하지 않는다.
export const CONNECT_STAGES=Object.freeze(['handleValidate','preRedeemContext','redeemReceive','postRedeemContext','credentialValidate','preSaveContext','vaultSave','saveAck','postSaveContext','finalContext','requestContext']);
export const CONNECT_DETAIL_CODES=Object.freeze([
  ...['PROOF_EXPIRED','SESSION_METADATA_INVALID','SESSION_IDENTITY_CHANGED','SESSION_INSTANCE_CHANGED','SESSION_EXPIRY_CHANGED','GENERATION_CHANGED'].map(v=>'NATIVE_HOST_'+v),
  ...['CONTEXT_UNVERIFIED','CONTEXT_CHANGED','CANCELLED','UNAVAILABLE','TIMEOUT','OUTCOME_UNKNOWN','REDIRECT_BLOCKED','REJECTED','RESPONSE_INVALID','HANDLE_INVALID','EXPIRED','STORAGE_UNVERIFIED'].map(v=>'ALEKOV_CONNECT_'+v),
  ...['INPUT_INVALID','DISABLED','CANCELLED','EXPIRED','TIMEOUT','RESPONSE_INVALID','CONTEXT_CHANGED','UNVERIFIED','OUTCOME_UNKNOWN','BUSY','REGISTRY_UNVERIFIED','PATH_UNSAFE','ACL_UNSAFE','ACL_MISMATCH','OWNER_MISMATCH','STORAGE_INVALID','COMPARE_FAILED','CAPACITY','DPAPI_FAILED'].map(v=>'NATIVE_HOST_'+v),
  ...['CREDENTIAL_INVALID','EXPIRED','CONFIGURATION_INVALID','WINDOWS_REQUIRED','CONTEXT_UNVERIFIED','CONTEXT_CHANGED','INPUT_INVALID','CANCELLED','TIMEOUT','EXECUTION_FAILED','OUTCOME_UNKNOWN','PROTOCOL_INVALID','ACL_UNSAFE','BUSY','COMPARE_FAILED','OWNER_MISMATCH','PATH_UNSAFE','RECORD_INVALID','STORAGE_FAILED','DPAPI_FAILED','ACCESS_DENIED','FILE_LOCKED','COMPILE_BLOCKED'].map(v=>'ALEKOV_VAULT_'+v),
  'OTHER',
]);
export const connectStage=value=>CONNECT_STAGES.includes(value)?value:null;
export const connectDetail=value=>CONNECT_DETAIL_CODES.includes(value)?value:'OTHER';
export function connectionErrorDetail(error){
  try{
    if(!error||typeof error!=='object'||types.isProxy(error))return 'OTHER';
    for(const key of ['detailCode','code']){const d=Object.getOwnPropertyDescriptor(error,key);if(d&&Object.hasOwn(d,'value')&&CONNECT_DETAIL_CODES.includes(d.value))return d.value;}
  }catch{}
  return 'OTHER';
}

export const ALEPH_PORTAL_ORIGIN='https://aleph-omega.vercel.app';
export const CLCO_GATEWAY_ORIGIN='https://ai-classroom-gateway-production.up.railway.app';
const CONTEXT=['subjectId','alephUserId','siteId','identityVersion','projectId'];
const CREDENTIAL=['schema','appId','audience',...CONTEXT,'grantId','grantVersion','credentialId','policyVersion','accessPolicyId','baseUrl','token','expiresAt'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(v);
const project=v=>id(v)&&v.length<=199&&!v.includes('..')&&!/^(?:[a-z]:|file:|sk-|sb_secret_|eyJ|bearer(?:$|[._:@-])|token(?:$|[._:@-]))/i.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))));
const contextDigest=context=>sha(JSON.stringify({context:{alephUserId:context.alephUserId,identityVersion:context.identityVersion,projectId:context.projectId,siteId:context.siteId,subjectId:context.subjectId},schema:'alekov.app-connect.context.v1'}));
const validContext=v=>exact(v,CONTEXT)&&CONTEXT.filter(k=>!['identityVersion','projectId'].includes(k)).every(k=>id(v[k]))&&project(v.projectId)&&positive(v.identityVersion);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fail=code=>{throw Object.assign(Error(code),{code});};
const ERRORS=new Set(['ALEKOV_CONNECT_CONTEXT_UNVERIFIED','ALEKOV_CONNECT_CONTEXT_CHANGED','ALEKOV_CONNECT_CANCELLED','ALEKOV_CONNECT_UNAVAILABLE','ALEKOV_CONNECT_TIMEOUT',
  'ALEKOV_CONNECT_OUTCOME_UNKNOWN','ALEKOV_CONNECT_REDIRECT_BLOCKED','ALEKOV_CONNECT_REJECTED','ALEKOV_CONNECT_RESPONSE_INVALID','ALEKOV_CONNECT_HANDLE_INVALID','ALEKOV_CONNECT_EXPIRED','ALEKOV_CONNECT_STORAGE_UNVERIFIED']);
const safe=(error,stage)=>{let innerStage;try{if(error&&typeof error==='object'&&!types.isProxy(error)){const p=Object.getOwnPropertyDescriptor(error,'failedStage');if(p&&Object.hasOwn(p,'value'))innerStage=connectStage(p.value);}}catch{}const detailCode=connectionErrorDetail(error),d=error&&typeof error==='object'&&!types.isProxy(error)?Object.getOwnPropertyDescriptor(error,'code'):null;
  return {ok:false,error:{code:d&&Object.hasOwn(d,'value')&&ERRORS.has(d.value)?d.value:'ALEKOV_CONNECT_OUTCOME_UNKNOWN',message:'앱 연결 상태를 확인할 수 없습니다. 담당자에게 연결 확인을 요청하세요.',...(stage?{failedStage:innerStage??connectStage(stage),detailCode}:{})}};};
function origin(value,allowLoopbackHttp){
  const url=new URL(value);
  if(url.origin!==value||url.username||url.password||url.pathname!=='/'||url.search||url.hash
    ||url.protocol!=='https:'&&!(allowLoopbackHttp&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))fail('ALEKOV_CONNECT_CONFIGURATION_INVALID');
  return value;
}

/** Explicit host configuration. Public handles contain no verifier or token. */
export function createAlekovAppConnector({enabled=false,gatewayOrigin=CLCO_GATEWAY_ORIGIN,portalOrigin=ALEPH_PORTAL_ORIGIN,allowLoopbackHttp=false,
  resolveCurrentContext,persistCredential,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=120000,pollIntervalMs=2000}={}){
  const requests=new WeakMap();let configured=false,gateway,portal;
  try{gateway=origin(gatewayOrigin,allowLoopbackHttp);portal=origin(portalOrigin,allowLoopbackHttp);
    configured=enabled===true&&typeof resolveCurrentContext==='function'&&typeof persistCredential==='function'&&typeof fetchImpl==='function'&&typeof clock==='function'
      &&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=420000&&Number.isSafeInteger(pollIntervalMs)&&pollIntervalMs>0&&pollIntervalMs<=10000;
  }catch{}
  const baseUrl=gateway+'/api/apps/aleph-on/v1',path=gateway+'/api/apps/aleph-on/connect/';
  async function current(expected){const value=structuredClone(await resolveCurrentContext());if(!validContext(value))fail('ALEKOV_CONNECT_CONTEXT_UNVERIFIED');if(expected&&canonical(value)!==canonical(expected))fail('ALEKOV_CONNECT_CONTEXT_CHANGED');return Object.freeze(value);}
  async function operation(signal,work,onStage){
    const controller=new AbortController();let code='ALEKOV_CONNECT_CANCELLED',timer,stop;
    let stage=typeof onStage==='function'?'handleValidate':null;
    const setStage=value=>{stage=connectStage(value);try{onStage?.(stage);}catch{}};
    const cancelled=()=>{code='ALEKOV_CONNECT_CANCELLED';controller.abort();};
    const alive=()=>{if(controller.signal.aborted)fail(code);};
    const bounded=async callback=>{alive();const value=await callback();alive();return value;};
    try{
      if(!configured)fail('ALEKOV_CONNECT_UNAVAILABLE');
      if(signal?.aborted)cancelled();else signal?.addEventListener('abort',cancelled,{once:true});
      const stopped=new Promise((_,reject)=>{stop=()=>reject(Object.assign(Error(code),{code}));controller.signal.addEventListener('abort',stop,{once:true});});
      timer=setTimeout(()=>{code='ALEKOV_CONNECT_TIMEOUT';controller.abort();},timeoutMs);alive();
      return await Promise.race([work({signal:controller.signal,alive,bounded,setStage}),stopped]);
    }catch(error){return safe(error,stage);}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancelled);controller.signal.removeEventListener('abort',stop);controller.abort();}
  }
  async function post(kind,body,op){
    let response;try{response=await op.bounded(()=>fetchImpl(path+kind,{method:'POST',redirect:'manual',cache:'no-store',credentials:'omit',signal:op.signal,
      headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)}));}catch(error){op.alive();fail('ALEKOV_CONNECT_OUTCOME_UNKNOWN');}
    if(response.status>=300&&response.status<400){await response.body?.cancel();fail('ALEKOV_CONNECT_REDIRECT_BLOCKED');}
    if(![200,201,202].includes(response.status)){await response.body?.cancel();fail(response.status>=500||[408,425,429].includes(response.status)?'ALEKOV_CONNECT_OUTCOME_UNKNOWN':'ALEKOV_CONNECT_REJECTED');}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||!response.body)fail('ALEKOV_CONNECT_RESPONSE_INVALID');
    const reader=response.body.getReader(),parts=[];let bytes=0;
    const abort=()=>{void reader.cancel().catch(()=>{});};op.signal.addEventListener('abort',abort,{once:true});
    try{while(true){const next=await op.bounded(()=>reader.read());if(next.done)break;bytes+=next.value.byteLength;if(bytes>16384)fail('ALEKOV_CONNECT_RESPONSE_INVALID');parts.push(Buffer.from(next.value));}}
    finally{op.signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{fail('ALEKOV_CONNECT_RESPONSE_INVALID');}
    return {status:response.status,value};
  }
  const approvalUrl=(deviceId,challenge)=>{const url=new URL('/workbench.html',portal);url.searchParams.set('appConnect','alekov');url.searchParams.set('appDevice',deviceId);url.searchParams.set('appChallenge',challenge);return url.href;};
  async function begin({signal}={}){return operation(signal,async op=>{
    const context=await op.bounded(()=>current()),deviceId=randomUUID(),verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    const expectedDigest=contextDigest(context),reply=await post('start',{deviceId,challenge,contextDigest:expectedDigest},op),v=reply.value;
    if(reply.status!==201||!exact(v,['schema','deviceId','challenge','contextDigest','expiresAt','approvalUrl','state'])||v.schema!=='alekov.app-connect.start.v2'||v.contextDigest!==expectedDigest||v.deviceId!==deviceId||v.challenge!==challenge||v.state!=='pending'
      ||v.approvalUrl!==approvalUrl(deviceId,challenge)||!iso(v.expiresAt)||Date.parse(v.expiresAt)<=clock()||Date.parse(v.expiresAt)>clock()+420000)fail('ALEKOV_CONNECT_RESPONSE_INVALID');
    await op.bounded(()=>current(context));const handle=Object.freeze({});requests.set(handle,{deviceId,verifier,challenge,context,expiresAt:v.expiresAt,state:'pending'});
    // Derive the public registration link only after verifying the original
    // exact3 server URL and current host context. Query project is no authority.
    const registrationLink=new URL(v.approvalUrl);registrationLink.searchParams.set('appRegistration','v1');registrationLink.searchParams.set('appProject',context.projectId);
    return {ok:true,handle,connection:Object.freeze({deviceId,approvalUrl:registrationLink.href,confirmation:deviceId.slice(0,4)+'-'+deviceId.slice(-4),expiresAt:v.expiresAt,state:'pending'})};
  });}
  async function complete(handle,{signal,onStage=()=>{}}={}){return operation(signal,async op=>{
    op.setStage('handleValidate');
    const request=requests.get(handle);if(!request||request.state!=='pending')fail('ALEKOV_CONNECT_HANDLE_INVALID');request.state='working';
    try{
      while(true){
        if(clock()>=Date.parse(request.expiresAt))fail('ALEKOV_CONNECT_EXPIRED');
        op.setStage('preRedeemContext');await op.bounded(()=>current(request.context));
        op.setStage('redeemReceive');const reply=await post('redeem',{deviceId:request.deviceId,verifier:request.verifier},op),v=reply.value;
        op.setStage('postRedeemContext');await op.bounded(()=>current(request.context));
        op.setStage('credentialValidate');
        if(reply.status===202){
          if(!exact(v,['schema','deviceId','state','expiresAt'])||v.schema!=='alekov.app-connect.pending.v1'||v.deviceId!==request.deviceId||v.state!=='pending'||v.expiresAt!==request.expiresAt)fail('ALEKOV_CONNECT_RESPONSE_INVALID');
          await op.bounded(()=>new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);op.signal.removeEventListener('abort',done);resolve();};timer=setTimeout(done,pollIntervalMs);op.signal.addEventListener('abort',done,{once:true});}));continue;
        }
        if(reply.status!==200||!exact(v,CREDENTIAL)||v.schema!=='alekov.app-connect.credential.v1'||v.appId!=='aleph-on'||v.audience!=='on-client'||CONTEXT.some(k=>v[k]!==request.context[k])
          ||['grantId','credentialId','policyVersion','accessPolicyId'].some(k=>!id(v[k]))||!positive(v.grantVersion)||v.baseUrl!==baseUrl||!/^sk-on-[A-Za-z0-9_-]{43}$/.test(v.token??'')||!iso(v.expiresAt)||Date.parse(v.expiresAt)<=clock())fail('ALEKOV_CONNECT_RESPONSE_INVALID');
        const fingerprint=sha(v.token),contextFingerprint=sha(canonical(request.context));
        op.setStage('preSaveContext');await op.bounded(()=>current(request.context));if(Date.parse(v.expiresAt)<=clock())fail('ALEKOV_CONNECT_EXPIRED');
        // The host sink must atomically compare expectedContext and honor signal.
        // Only the application server sees this value, never browser/UI output.
        op.setStage('vaultSave');const saved=await op.bounded(()=>persistCredential({connectionId:request.deviceId,expectedContext:structuredClone(request.context),credential:structuredClone(v)},{signal:op.signal}));
        op.setStage('saveAck');
        if(!exact(saved,['connectionId','credentialFingerprint','contextFingerprint','persisted'])||saved.connectionId!==request.deviceId||saved.credentialFingerprint!==fingerprint||saved.contextFingerprint!==contextFingerprint||saved.persisted!==true)fail('ALEKOV_CONNECT_STORAGE_UNVERIFIED');
        op.setStage('postSaveContext');await op.bounded(()=>current(request.context));if(Date.parse(v.expiresAt)<=clock())fail('ALEKOV_CONNECT_EXPIRED');request.state='connected';request.verifier=null;
        return {ok:true,connection:Object.freeze({appId:'aleph-on',audience:'on-client',credentialId:v.credentialId,projectId:v.projectId,expiresAt:v.expiresAt,state:'connected',workbenchRequiredAtRuntime:false,manualSecretInputs:0})};
      }
    }catch(error){request.state='unknown';request.verifier=null;throw error;}
  },onStage);}
  return Object.freeze({available:configured,begin,complete});
}
