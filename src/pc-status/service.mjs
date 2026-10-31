// 내 PC의 CPU·메모리·디스크를 일반 권한으로 읽습니다(관리자 권한 불필요, 명령 실행 없음).
// 읽지 못한 값은 0이나 예시 값으로 대신하지 않고 status 'unavailable' 과 이유를 돌려줍니다.
import os from 'node:os';
import {statfs} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const GIB=1024**3;
const SAMPLE_MS=500;
const round1=n=>Math.round(n*10)/10;
const unavailable=reason=>({status:'unavailable',reason});

function cpuTimes(){
  const cpus=os.cpus();
  if(!Array.isArray(cpus)||cpus.length===0)return null;
  let idle=0,total=0;
  for(const {times} of cpus){idle+=times.idle;total+=times.user+times.nice+times.sys+times.idle+times.irq;}
  return {idle,total};
}

async function readCpu(sleep){
  try{
    const a=cpuTimes();if(!a)return unavailable('운영체제가 CPU 시간을 알려 주지 않았습니다.');
    await sleep(SAMPLE_MS);
    const b=cpuTimes();if(!b)return unavailable('운영체제가 CPU 시간을 알려 주지 않았습니다.');
    const total=b.total-a.total;
    if(!(total>0))return unavailable('측정 구간이 너무 짧아 계산하지 못했습니다.');
    const percent=(1-(b.idle-a.idle)/total)*100;
    if(!Number.isFinite(percent))return unavailable('계산 결과가 올바르지 않습니다.');
    return {status:'ok',value:round1(Math.min(100,Math.max(0,percent))),unit:'%',windowMs:SAMPLE_MS};
  }catch{return unavailable('CPU 시간을 읽지 못했습니다.');}
}

function readMemory(){
  try{
    const total=os.totalmem(),free=os.freemem();
    if(!(total>0)||!Number.isFinite(free)||free<0||free>total)return unavailable('메모리 값을 확인할 수 없습니다.');
    const used=total-free;
    return {status:'ok',usedGiB:round1(used/GIB),totalGiB:round1(total/GIB),percent:round1(used/total*100),unit:'GiB'};
  }catch{return unavailable('메모리 값을 읽지 못했습니다.');}
}

async function readDisk(path){
  try{
    const s=await statfs(path);
    const size=Number(s.bsize),total=Number(s.blocks)*size,free=Number(s.bavail)*size;
    if(!(total>0)||!Number.isFinite(free)||free<0||free>total)return unavailable('디스크 값을 확인할 수 없습니다.');
    return {status:'ok',freeGiB:round1(free/GIB),totalGiB:round1(total/GIB),unit:'GiB',scope:'앱 폴더가 있는 드라이브'};
  }catch{return unavailable('디스크 정보를 읽지 못했습니다(권한 또는 지원되지 않는 환경).');}
}

export function createPcStatusService({clock=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),diskPath=resolve(fileURLToPath(import.meta.url),'..','..','..')}={}){
  return {
    async read(){
      const [cpu,memory,disk]=await Promise.all([readCpu(sleep),Promise.resolve(readMemory()),readDisk(diskPath)]);
      return {source:'node-os',measuredAt:clock().toISOString(),cpu,memory,disk};
    },
  };
}
