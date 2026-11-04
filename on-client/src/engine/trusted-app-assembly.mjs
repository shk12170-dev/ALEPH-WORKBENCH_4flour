// Host-owned composition; process separation is not an OS boundary for the same SID.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {types} from 'node:util';
import {isOwnedSdpHostEngine} from './sdp-host.mjs';
import {createEnginePeer,ENGINE_METHODS} from './student-engine-ipc.mjs';
const assemblies=new WeakMap(),claimed=new WeakSet(),WORKER=fileURLToPath(new URL('./student-engine-worker.mjs',import.meta.url));
const fail=()=>{throw Object.assign(Error('TRUSTED_APP_ASSEMBLY_INVALID'),{code:'TRUSTED_APP_ASSEMBLY_INVALID'});};
function capture(raw){if(!raw||typeof raw!=='object'||types.isProxy(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))fail();const fields=Object.getOwnPropertyDescriptors(raw),allowed=['sdpHostEngine','studentModulePath','sdpActionStartup','signal','timeoutMs'];if(Reflect.ownKeys(fields).some(k=>!allowed.includes(k)||!Object.hasOwn(fields[k],'value')||!fields[k].enumerable)||!['sdpHostEngine','studentModulePath'].every(k=>Object.hasOwn(fields,k)))fail();return Object.fromEntries(Object.entries(fields).map(([k,d])=>[k,d.value]));}
function startup(raw){if(raw===undefined)return undefined;if(!raw||types.isProxy(raw)||Object.getPrototypeOf(raw)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(d).length!==2||!['databasePath','policy'].every(k=>Object.hasOwn(d[k]??{},'value')))fail();let nodes=0;const clone=(v,depth=0)=>{if(++nodes>4096||depth>16)fail();if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;if(!v||typeof v!=='object'||types.isProxy(v))fail();if(Array.isArray(v))return Object.freeze(v.map(x=>clone(x,depth+1)));if(Object.getPrototypeOf(v)!==Object.prototype)fail();const out={};for(const k of Reflect.ownKeys(v)){const field=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!Object.hasOwn(field,'value')||!field.enumerable)fail();Object.defineProperty(out,k,{value:clone(field.value,depth+1),enumerable:true});}return Object.freeze(out);};return clone(raw);}
export function readTrustedAppAssembly(value){if(!value||types.isProxy(value))fail();const s=assemblies.get(value);if(!s||s.closed||!s.peer.ready()||!isOwnedSdpHostEngine(s.host))fail();return Object.freeze({engine:s.engine,sdpHostEngine:s.host,...(s.startup?{sdpActionStartup:s.startup}:{}),close:s.close});}
// A bootstrap reserves ownership synchronously before any asynchronous startup.
// Only its one-use opaque token may attach; another failed startup gets no cleanup view.
export function claimTrustedAppAssembly(value){readTrustedAppAssembly(value);const s=assemblies.get(value);if(s.attached||s.reservation)fail();const token=Object.freeze(Object.create(null));s.reservation=token;assemblies.set(token,s);return token;}
export function attachTrustedAppAssembly(value){const view=readTrustedAppAssembly(value),s=assemblies.get(value);if(s.attached||s.reservation&&s.reservation!==value)fail();s.attached=true;return view;}
export async function createTrustedAppAssembly(options){
 const o=capture(options),host=o.sdpHostEngine,timeoutMs=o.timeoutMs??10000;if(!isOwnedSdpHostEngine(host)||claimed.has(host)||typeof o.studentModulePath!=='string'||!path.isAbsolute(o.studentModulePath)||/[\u0000-\u001f\u007f]/.test(o.studentModulePath)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000||o.signal!==undefined&&(!(o.signal instanceof AbortSignal)||types.isProxy(o.signal))||o.signal?.aborted)fail();
 const actionStartup=startup(o.sdpActionStartup);claimed.add(host);const generation=randomUUID();
 // No inherited env/Node options, IPC fd, native configuration or credentials.
 const child=spawn(process.execPath,[WORKER,generation],{cwd:path.dirname(o.studentModulePath),env:{...(process.platform==='win32'?{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows'}:{}),PATH:path.dirname(process.execPath)},windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
 let closed=false,exited=false,exitResolve,closePromise;const exit=new Promise(r=>exitResolve=r);let peer;
 const stop=()=>{if(closed)return;closed=true;peer?.close();child.stdin.destroy();if(!exited)child.kill();host.close();o.signal?.removeEventListener('abort',stop);};
 const close=()=>{stop();return closePromise??=(exited?Promise.resolve():Promise.race([exit,new Promise((_,reject)=>{const timer=setTimeout(()=>{if(!exited){child.kill('SIGKILL');reject(Object.assign(Error('ENGINE_WORKER_CLOSE_FAILED'),{code:'ENGINE_WORKER_CLOSE_FAILED'}));}},2000);timer.unref();exit.then(()=>clearTimeout(timer));})]));};
 child.once('error',()=>{stop();exitResolve();});child.once('close',()=>{exited=true;stop();exitResolve();});child.stdin.on('error',()=>stop());
 peer=createEnginePeer({input:child.stdout,write:b=>child.stdin.write(b),generation,incoming:ENGINE_METHODS,outgoing:['initialize',...ENGINE_METHODS],timeoutMs,onFault:stop,dispatch(method,args,call){if(!isOwnedSdpHostEngine(host)||!ENGINE_METHODS.includes(method))fail();return host[method](...args,call);}});
 o.signal?.addEventListener('abort',stop,{once:true});if(o.signal?.aborted)stop();
 try{
  const meta=await peer.call('initialize',[o.studentModulePath,host.projectId],{signal:o.signal});if(closed||!meta||Object.keys(meta).sort().join(',')!=='evidenceMode,projectId'||!['connected','disconnected'].includes(meta.evidenceMode)||meta.evidenceMode==='connected'&&meta.projectId!==host.projectId)fail();
  const engine=Object.freeze({evidenceMode:meta.evidenceMode,projectId:host.projectId,readIdentity:call=>peer.call('readIdentity',[],call),readApps:(scope,call)=>peer.call('readApps',[scope],call),decideAccess:(input,scope,call)=>peer.call('decideAccess',[input,scope],call),readEvents:(scope,call)=>peer.call('readEvents',[scope],call),readDevices:(scope,call)=>peer.call('readDevices',[scope],call),readSessions:(scope,call)=>peer.call('readSessions',[scope],call)});
  const cap=Object.freeze(Object.create(null));assemblies.set(cap,{get closed(){return closed;},host,peer,engine,startup:actionStartup,close});return cap;
 }catch(error){await close();throw error;}
}
