// Bounded, bidirectional DTO channel. This is not an authority/engine brand.
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
export const ENGINE_METHODS=Object.freeze(['readIdentity','readApps','decideAccess','readEvents','readDevices','readSessions']);
const arity=method=>method==='initialize'||method==='decideAccess'?2:method==='readIdentity'?0:1;
const SCHEMA='alekov.student-engine.ipc.v1',MAX=262144,LIMIT=8,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODES=new Set(['ENGINE_NOT_CONNECTED','ENGINE_ADAPTER_INVALID','ENGINE_RESULT_UNVERIFIED','SUBJECT_SCOPE_UNVERIFIED','ENGINE_TIMEOUT','REQUEST_CANCELLED']);
const fault=code=>Object.assign(Error(code),{code});
const plain=v=>v!==null&&typeof v==='object'&&!types.isProxy(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));
function data(value,depth=0,budget={n:0}){if(++budget.n>12000||depth>20)throw fault('ENGINE_RESULT_UNVERIFIED');if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=MAX||typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value)&&!types.isProxy(value)){if(value.length>2048)throw fault('ENGINE_RESULT_UNVERIFIED');return value.map(v=>data(v,depth+1,budget));}
 if(!plain(value))throw fault('ENGINE_RESULT_UNVERIFIED');const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!Object.hasOwn(d,'value')||!d.enumerable)throw fault('ENGINE_RESULT_UNVERIFIED');Object.defineProperty(out,key,{value:data(d.value,depth+1,budget),enumerable:true,writable:true,configurable:true});}return out;
}
function pack(value){const coverage=Array.isArray(value)?Object.getOwnPropertyDescriptor(value,'coverage'):undefined;if(coverage&&!Object.hasOwn(coverage,'value'))throw fault('ENGINE_RESULT_UNVERIFIED');return {data:data(value),coverage:coverage?data(coverage.value):null};}
function unpack(value){if(!exact(value,['data','coverage'])||value.coverage!==null&&!Array.isArray(value.data))throw fault('ENGINE_RESULT_UNVERIFIED');const out=data(value.data);if(value.coverage!==null)Object.defineProperty(out,'coverage',{value:data(value.coverage),enumerable:false});return out;}
const safeCode=e=>{try{const d=Object.getOwnPropertyDescriptor(e??{},'code');return d&&Object.hasOwn(d,'value')&&CODES.has(d.value)?d.value:'ENGINE_NOT_CONNECTED';}catch{return 'ENGINE_NOT_CONNECTED';}};
export function createEnginePeer({input,write,generation,incoming,outgoing,dispatch,onFault=()=>{},timeoutMs=10000}){
 if(!UUID.test(generation)||!Array.isArray(incoming)||!Array.isArray(outgoing)||typeof dispatch!=='function'||typeof write!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fault('ENGINE_ADAPTER_INVALID');
 const pending=new Map(),running=new Map(),retired=new Set(),completed=new Set();let closed=false,buffer=Buffer.alloc(0);
 const remember=(set,id)=>{set.add(id);if(set.size>256)set.delete(set.values().next().value);};
 function close(code='ENGINE_NOT_CONNECTED'){if(closed)return;closed=true;input.off('data',receive);input.off('end',ended);input.off('error',ended);for(const p of pending.values())p.finish(fault(code));pending.clear();for(const c of running.values())c.abort();running.clear();buffer=Buffer.alloc(0);}
 function broken(){if(closed)return;close();try{onFault();}catch{}}
 function send(frame){if(closed)throw fault('ENGINE_NOT_CONNECTED');const b=Buffer.from(JSON.stringify({schema:SCHEMA,generation,...frame})+'\n');if(b.length>MAX)throw fault('ENGINE_RESULT_UNVERIFIED');try{write(b);}catch{broken();throw fault('ENGINE_NOT_CONNECTED');}}
 async function frame(raw){if(closed)return;try{
  if(!plain(raw)||raw.schema!==SCHEMA||raw.generation!==generation||!UUID.test(raw.id))throw 0;
  if(raw.kind==='call'){
   if(!exact(raw,['schema','generation','kind','id','method','args'])||!incoming.includes(raw.method)||!Array.isArray(raw.args)||raw.args.length!==arity(raw.method)||running.has(raw.id)||completed.has(raw.id)||running.size>=LIMIT)throw 0;
   const controller=new AbortController();running.set(raw.id,controller);
   try{const value=await dispatch(raw.method,data(raw.args),{signal:controller.signal});if(!controller.signal.aborted&&!closed)send({kind:'result',id:raw.id,ok:true,value:pack(value)});}
   catch(e){if(!controller.signal.aborted&&!closed)send({kind:'result',id:raw.id,ok:false,code:safeCode(e)});}
   finally{running.delete(raw.id);remember(completed,raw.id);}
  }else if(raw.kind==='cancel'){
   if(!exact(raw,['schema','generation','kind','id']))throw 0;running.get(raw.id)?.abort();
  }else if(raw.kind==='result'){
   if(typeof raw.ok!=='boolean'||!exact(raw,raw.ok?['schema','generation','kind','id','ok','value']:['schema','generation','kind','id','ok','code']))throw 0;
   const p=pending.get(raw.id);if(!p){if(retired.has(raw.id))return;throw 0;}if(performance.now()>=p.until){p.finish(fault('ENGINE_TIMEOUT'));return;}
   if(raw.ok)p.finish(null,unpack(raw.value));else{if(!CODES.has(raw.code))throw 0;p.finish(fault(raw.code));}
  }else throw 0;
 }catch{broken();}}
 function receive(chunk){if(closed)return;try{let at=0;while(at<chunk.length){const end=chunk.indexOf(10,at),last=end<0?chunk.length:end;if(buffer.length+last-at>MAX){broken();return;}buffer=Buffer.concat([buffer,chunk.subarray(at,last)]);if(end<0)return;const bytes=buffer;buffer=Buffer.alloc(0);const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));void frame(raw);if(closed)return;at=end+1;}}catch{broken();}}
 const ended=()=>broken();input.on('data',receive);input.once('end',ended);input.once('error',ended);
 function call(method,args=[],{signal}={}){
  if(closed||!outgoing.includes(method)||pending.size>=LIMIT||!Array.isArray(args)||args.length!==arity(method))return Promise.reject(fault('ENGINE_NOT_CONNECTED'));
  if(signal!==undefined&&(!(signal instanceof AbortSignal)||types.isProxy(signal)))return Promise.reject(fault('ENGINE_RESULT_UNVERIFIED'));if(signal?.aborted)return Promise.reject(fault('REQUEST_CANCELLED'));
  return new Promise((resolve,reject)=>{const id=randomUUID(),until=performance.now()+timeoutMs;let timer;
   const finish=(error,value)=>{if(!pending.delete(id))return;clearTimeout(timer);signal?.removeEventListener('abort',abort);remember(retired,id);error?reject(error):resolve(value);};
   const abort=()=>{try{send({kind:'cancel',id});}catch{}finish(fault('REQUEST_CANCELLED'));};
   pending.set(id,{finish,until});timer=setTimeout(()=>{try{send({kind:'cancel',id});}catch{}finish(fault('ENGINE_TIMEOUT'));},timeoutMs);signal?.addEventListener('abort',abort,{once:true});
   try{send({kind:'call',id,method,args:data(args)});}catch(e){finish(fault(safeCode(e)));}if(signal?.aborted)abort();
  });
 }
 return Object.freeze({call,close,ready:()=>!closed});
}
