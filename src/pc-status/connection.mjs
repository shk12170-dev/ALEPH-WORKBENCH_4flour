// 3일차(학생 추가): 이 PC의 네트워크 연결, 방화벽 설정, Windows 기록(System·Application)의 경고·오류 건수를 읽기만 합니다.
// 설정을 바꾸는 명령(Set-/New-/Remove-/Enable-/Disable-, netsh ... set 등)은 쓰지 않습니다. 아래 명령은 모두 조회 전용 고정 문구이며 사용자 입력이 들어가지 않습니다.
// 읽지 못한 항목은 0이나 예시 값 대신 status 'unavailable' 과 이유를 돌려줍니다. 기록 건수는 침해·공격 탐지 결과가 아닙니다.
import {execFile} from 'node:child_process';

const TIMEOUT_MS=12000;
const EVENT_HOURS=24;
const PREFIX='[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";';
const unavailable=reason=>({status:'unavailable',reason});

const SCRIPTS={
  network:"Get-NetAdapter | ForEach-Object { @{Name=[string]$_.Name;Status=[string]$_.Status;Media=[string]$_.PhysicalMediaType;Virtual=[bool]$_.Virtual} } | ConvertTo-Json -Compress",
  firewall:"Get-NetFirewallProfile | ForEach-Object { @{Name=[string]$_.Name;Enabled=[string]$_.Enabled} } | ConvertTo-Json -Compress",
};
const eventScript=log=>`try{$e=@(Get-WinEvent -FilterHashtable @{LogName='${log}';StartTime=(Get-Date).AddHours(-${EVENT_HOURS});Level=2,3} -ErrorAction Stop)}catch{if($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'){$e=@()}else{throw}};@{error=@($e|Where-Object{$_.Level -eq 2}).Count;warning=@($e|Where-Object{$_.Level -eq 3}).Count} | ConvertTo-Json -Compress`;

function run(script){
  return new Promise(resolve=>{
    if(process.platform!=='win32'){resolve({error:'이 PC는 Windows가 아니라서 읽을 수 없습니다.'});return;}
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',PREFIX+script],{timeout:TIMEOUT_MS,windowsHide:true,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{
      if(error){
        if(error.killed||error.signal||error.code==='ETIMEDOUT')resolve({error:'시간 초과로 읽지 못했습니다.'});
        else if(/access|denied|unauthorized|권한/i.test(`${stderr}${error.message}`))resolve({error:'권한이 없어 읽지 못했습니다(관리자 권한이 필요한 항목).'});
        else if(error.code==='ENOENT')resolve({error:'PowerShell을 찾지 못했습니다.'});
        else resolve({error:'읽지 못했습니다.'});
        return;
      }
      try{resolve({data:JSON.parse(stdout.trim())});}catch{resolve({error:'읽은 결과를 해석하지 못했습니다.'});}
    });
  });
}
const list=v=>Array.isArray(v)?v:v&&typeof v==='object'?[v]:[];

async function readNetwork(){
  const r=await run(SCRIPTS.network);if(r.error)return unavailable(r.error);
  const adapters=list(r.data).filter(a=>typeof a?.Name==='string').map(a=>{
    const media=String(a.Media??'');
    const kind=a.Virtual===true?'가상':/802\.11/.test(media)?'무선':/802\.3|ethernet/i.test(media)?'유선':'종류 확인 불가';
    return {name:a.Name.slice(0,60),kind,connected:a.Status==='Up'?true:a.Status==='Disconnected'||a.Status==='Disabled'||a.Status==='Not Present'?false:null};
  });
  return {status:'ok',adapters};
}

async function readFirewall(){
  const r=await run(SCRIPTS.firewall);if(r.error)return unavailable(r.error);
  const profiles=list(r.data).filter(p=>typeof p?.Name==='string').map(p=>({name:p.Name.slice(0,30),enabled:/^(true|1)$/i.test(p.Enabled)?true:/^(false|0)$/i.test(p.Enabled)?false:null}));
  if(profiles.length===0)return unavailable('방화벽 프로필을 읽지 못했습니다.');
  return {status:'ok',profiles};
}

async function readEvents(log){
  const r=await run(eventScript(log));if(r.error)return unavailable(r.error);
  const {error,warning}=r.data??{};
  if(!Number.isInteger(error)||!Number.isInteger(warning)||error<0||warning<0)return unavailable('읽은 건수를 확인할 수 없습니다.');
  return {status:'ok',error,warning,hours:EVENT_HOURS};
}

// SDP 서버 연결 상태는 PC 조회와 따로 판단합니다. 연결을 확인하지 못했으면 미연결로 단정하지 않습니다.
export function sdpState(mode){
  if(mode==='disconnected')return {state:'not_connected',label:'SDP 미연결',reason:'SDP 호스트 설정 없이 실행 중입니다.'};
  if(mode==='demo')return {state:'demo',label:'예제 자료(SDP 연결 아님)',reason:'예제 모드라 실제 SDP 서버에 연결하지 않았습니다.'};
  return {state:'unknown',label:'확인 불가',reason:'연결 설정은 있지만 실제 연결 성공은 확인하지 못했습니다.'};
}

export function createPcConnectionService({clock=()=>new Date()}={}){
  return {
    async read(mode){
      const [network,firewall,system,application]=await Promise.all([readNetwork(),readFirewall(),readEvents('System'),readEvents('Application')]);
      return {source:'windows-readonly',measuredAt:clock().toISOString(),network,firewall,events:{system,application},sdp:sdpState(mode)};
    },
  };
}
