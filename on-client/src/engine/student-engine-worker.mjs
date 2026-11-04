// Fixed child entry. Never imports native/SDP/vault/signer/TLS/configuration code.
import {loadEngine,engineMethod} from '../engine.mjs';
import {createEnginePeer,ENGINE_METHODS} from './student-engine-ipc.mjs';
const protocolWrite=process.stdout.write.bind(process.stdout);
// Ordinary adapter logs must not become protocol frames. Malformed direct writes fail closed.
process.stdout.write=process.stderr.write.bind(process.stderr);
let engine=null,initializing=false,initialized=false;
const peer=createEnginePeer({input:process.stdin,write:protocolWrite,generation:process.argv[2],incoming:['initialize',...ENGINE_METHODS],outgoing:ENGINE_METHODS,onFault:()=>{process.exitCode=2;process.stdin.destroy();},async dispatch(method,args,{signal}){
 if(method==='initialize'){
  if(initializing||initialized||args.length!==2||typeof args[0]!=='string'||typeof args[1]!=='string')throw Error('ENGINE_ADAPTER_INVALID');initializing=true;
  const capability=Object.freeze({projectId:args[1],readIdentity:(o)=>peer.call('readIdentity',[],o),readApps:(scope,o)=>peer.call('readApps',[scope],o),decideAccess:(input,scope,o)=>peer.call('decideAccess',[input,scope],o),readEvents:(scope,o)=>peer.call('readEvents',[scope],o),readDevices:(scope,o)=>peer.call('readDevices',[scope],o),readSessions:(scope,o)=>peer.call('readSessions',[scope],o)});
  engine=await loadEngine(args[0],{hostCapability:capability});if(signal.aborted)throw Object.assign(Error('REQUEST_CANCELLED'),{code:'REQUEST_CANCELLED'});initialized=true;return {evidenceMode:engine.evidenceMode,projectId:typeof engine.projectId==='string'?engine.projectId:null};
 }
 if(!initialized||!ENGINE_METHODS.includes(method))throw Error('ENGINE_NOT_CONNECTED');return engineMethod(engine,method)(...args,{signal});
}});
process.stdin.once('end',()=>peer.close());
