// 11일차(학생 추가): 공식 연습 경보로 위험 판단(차단 수준/알림/기록)을 시연합니다.
// 입력은 student/practice/fixtures 의 연습 경보(실제 로그 아님)입니다. 파일을 읽고 계산만 하며, 네트워크·셸·차단 실행은 없습니다.
// decide 모듈 6개는 방어전 1~12단계 저장소(vault)의 보너스 xdr-01~06 결과를 내용 그대로 복사한 것입니다.
// 화면에는 계정·주소 원문을 내지 않습니다(패턴 이름·MITRE 태그·이유만).
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const MODULES=Object.freeze([
  ['brute-force','무차별 로그인'],['web-injection','웹 주입'],['known-cve','알려진 취약점'],
  ['persistence','지속성 확보'],['privilege','권한 상승'],['exfiltration','자료 유출'],
]);
const ACTIONS=['block','alert','record'];

// 이유 문장에서 계정·주소가 새어 나가지 않게, 알려진 모양의 값만 가립니다(안전망).
const mask=s=>String(s).replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g,'[주소]').slice(0,300);

export function createPracticeAlertsService({root}){
  const base=resolve(root,'student/practice');
  const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
  return {async read(){
    const modules=[];
    for(const [key,label] of MODULES){
      try{
        const {decide}=await import(pathToFileURL(resolve(base,key,'decide.mjs')).href);
        const fixture=await readJson(resolve(base,'fixtures',`${key}.json`));
        const expected=await readJson(resolve(base,'expected',`${key}.json`));
        const rows=fixture.alerts.map(a=>{const d=decide(a);return {alertId:a.id,level:a.rule?.level??null,action:d.action,confidence:d.confidence,reason:mask(d.reason)};});
        const counts=Object.fromEntries(ACTIONS.map(x=>[x,rows.filter(r=>r.action===x).length]));
        const exp=new Map(expected.decisions.map(d=>[d.alertId,d.action]));
        const same=rows.filter(r=>exp.get(r.alertId)===r.action).length;
        modules.push({key,label,status:'ok',total:rows.length,counts,vaultMatch:same,vaultTotal:expected.decisions.length,rows});
      }catch(error){
        // 읽지 못한 모듈은 0건으로 세지 않고 읽지 못함으로 따로 둡니다.
        modules.push({key,label,status:'unavailable',message:'이 모듈을 읽지 못했습니다.',code:String(error?.code??error?.name??'ERROR')});
      }
    }
    const ok=modules.filter(m=>m.status==='ok');
    const sum=k=>ok.reduce((n,m)=>n+m.counts[k],0);
    return {
      label:'예시 화면 · 설명용 값',
      notice:'공식 연습 경보를 판단 모듈에 넣어 서버가 계산한 값입니다. 이 PC의 실제 탐지가 아니며, 차단·전송 같은 조치는 실행하지 않습니다.',
      total:ok.reduce((n,m)=>n+m.total,0),
      counts:{block:sum('block'),alert:sum('alert'),record:sum('record')},
      modulesOk:ok.length,modulesTotal:MODULES.length,
      vaultMatch:ok.reduce((n,m)=>n+m.vaultMatch,0),vaultTotal:ok.reduce((n,m)=>n+m.vaultTotal,0),
      modules,
    };
  }};
}
