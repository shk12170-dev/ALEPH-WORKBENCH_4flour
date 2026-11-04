// 본인 PC의 비식별 상태만 읽는다. 원격 호출·OS 설정 변경·권한 상승은 하지 않는다.
import os from 'node:os';
import {statfs} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';

const execute = promisify(execFile);
const diskRoot = fileURLToPath(new URL('../', import.meta.url));
// 명령과 조회 범위는 고정이다. 이벤트 본문·사용자·호스트·주소를 출력하지 않는다.
const WINDOWS_READ = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = @{}
function Read-FailureReason($failure) {
  if ($failure.Exception -is [System.UnauthorizedAccessException] -or $failure.FullyQualifiedErrorId -match 'AccessDenied|Unauthorized' -or $failure.CategoryInfo.Category -eq 'PermissionDenied') { return 'permission_denied' }
  return 'query_failed'
}
try {
  $profiles = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object {
    $enabled = switch ([string]$_.Enabled) { 'True' { $true }; 'False' { $false }; default { $null } }
    @{ name = [string]$_.Name; enabled = $enabled }
  })
  $result.firewall = @{ state = 'ok'; profiles = $profiles }
} catch { $result.firewall = @{ state = 'unavailable'; reason = (Read-FailureReason $_) } }
$since = (Get-Date).AddHours(-24)
try {
  $events = @()
  foreach ($log in @('System','Application')) {
    try { $events += @(Get-WinEvent -FilterHashtable @{ LogName = $log; StartTime = $since; Level = @(2,3) } -MaxEvents 5001 -ErrorAction Stop) }
    catch { if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { throw } }
  }
  $truncated = $events.Count -gt 5000
  $sample = @($events | Sort-Object -Property TimeCreated -Descending | Select-Object -First 5000)
  $result.events = @{ state = 'ok'; warningCount = @($sample | Where-Object { $_.Level -eq 3 }).Count; errorCount = @($sample | Where-Object { $_.Level -eq 2 }).Count; truncated = $truncated; sampleLimit = 5000; since = $since.ToUniversalTime().ToString('o') }
} catch {
  $result.events = @{ state = 'unavailable'; reason = (Read-FailureReason $_) }
}
$result | ConvertTo-Json -Depth 5 -Compress
`;
const missing = reason => ({state: 'unavailable', reason});
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const cpuTimes = cpus => {
  if (!Array.isArray(cpus) || !cpus.length) return null;
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    const times = cpu?.times;
    if (!times || !['user', 'nice', 'sys', 'idle', 'irq'].every(k => finite(times[k]))) return null;
    idle += times.idle; total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return {idle, total};
};
export function cpuUsage(before, after) {
  const a = cpuTimes(before), b = cpuTimes(after);
  if (!a || !b || b.total <= a.total || b.idle < a.idle || b.idle - a.idle > b.total - a.total) return missing('invalid_sample');
  return {state: 'ok', usagePercent: Math.round(1000 * (1 - (b.idle - a.idle) / (b.total - a.total))) / 10};
}
export function normalizeWindowsStatus(raw) {
  const result = {firewall: missing('invalid_response'), events: missing('invalid_response')};
  if (raw?.firewall?.state === 'unavailable') result.firewall = missing(raw.firewall.reason === 'permission_denied' ? 'permission_denied' : 'query_failed');
  const profiles = raw?.firewall?.profiles;
  if (raw?.firewall?.state === 'ok' && Array.isArray(profiles) && profiles.length === 3 && ['Domain', 'Private', 'Public'].every(name => profiles.some(p => p.name === name && typeof p.enabled === 'boolean'))) {
    result.firewall = {state: 'ok', profiles: ['Domain', 'Private', 'Public'].map(name => {const p = profiles.find(v => v.name === name); return {name, enabled: p.enabled};})};
  }
  const e = raw?.events;
  if (e?.state === 'unavailable') result.events = missing(e.reason === 'permission_denied' ? 'permission_denied' : 'query_failed');
  if (e?.state === 'ok' && count(e.warningCount) && count(e.errorCount) && e.warningCount + e.errorCount <= 5000 && e.sampleLimit === 5000 && typeof e.truncated === 'boolean' && typeof e.since === 'string' && Number.isFinite(Date.parse(e.since))) {
    result.events = {state: 'ok', warningCount: e.warningCount, errorCount: e.errorCount, truncated: e.truncated, sampleLimit: 5000, since: e.since};
  }
  return result;
}

export function createPcStatusReader({system = os, disk = statfs, run = execute, platform = os.platform(), clock = () => new Date(), pause = wait} = {}) {
  return async function read({signal, directory = diskRoot} = {}) {
    signal?.throwIfAborted();
    const metrics = {};
    const cpu = (async () => {
      try {const before = system.cpus(); await pause(200, undefined, {signal}); metrics.cpu = {...cpuUsage(before, system.cpus()), sampleMs: 200};}
      catch {metrics.cpu = missing(signal?.aborted ? 'cancelled' : 'query_failed');}
    })();
    try {
      const totalBytes = system.totalmem(), freeBytes = system.freemem();
      metrics.memory = finite(totalBytes) && totalBytes > 0 && finite(freeBytes) && freeBytes <= totalBytes ? {state: 'ok', usedBytes: totalBytes - freeBytes, totalBytes} : missing('invalid_response');
    } catch {metrics.memory = missing('query_failed');}
    try {
      const entries = Object.values(system.networkInterfaces()).filter(Array.isArray).map(rows => rows.filter(row => row.internal === false));
      metrics.network = {state: 'ok', interfaceCount: entries.filter(rows => rows.length).length, ipv4Count: entries.flat().filter(row => row.family === 'IPv4' || row.family === 4).length};
    } catch {metrics.network = missing('query_failed');}
    const drive = (async () => {
      try {const d = await disk(directory); const totalBytes = Number(d.blocks) * Number(d.bsize), freeBytes = Number(d.bavail) * Number(d.bsize);
        metrics.disk = finite(totalBytes) && totalBytes > 0 && finite(freeBytes) && freeBytes <= totalBytes ? {state: 'ok', totalBytes, freeBytes} : missing('invalid_response');}
      catch {metrics.disk = missing('query_failed');}
    })();
    const windows = (async () => {
      if (platform !== 'win32') {metrics.firewall = missing('unsupported'); metrics.events = missing('unsupported'); return;}
      try {
        const exe = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const {stdout} = await run(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ], {windowsHide: true, encoding: 'utf8', timeout: 8000, maxBuffer: 128 * 1024, signal});
        Object.assign(metrics, normalizeWindowsStatus(JSON.parse(stdout.trim())));
      } catch (error) {
        const reason = signal?.aborted ? 'cancelled' : error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'query_failed' : error?.killed || error?.code === 'ETIMEDOUT' ? 'timeout' : 'query_failed';
        metrics.firewall = missing(reason); metrics.events = missing(reason);
      }
    })();
    await Promise.all([cpu, drive, windows]); signal?.throwIfAborted();
    return {schema: 'aleph.on.pc-status.v1', measuredAt: clock().toISOString(), source: 'local-pc', metrics};
  };
}
export const readPcStatus = createPcStatusReader();
