// 10단계 제작 1·2: 안전 정책(판정기 규칙, allowedRoutes, DB 접근 정책) 사본·해시·차이·되돌리기 도구입니다.
// 사본은 backup/policy/에 있고, manifest.json의 SHA-256으로 다시 읽어 검증한 뒤에만 비교·복원합니다.
// 실제 운영 정책 파일(src/, aleph.config.json, supabase/)은 snapshot이 읽기만 하고 바꾸지 않습니다.
//   node scripts/policy-backup.mjs snapshot            현재 안전 정책의 사본·해시 만들기(있으면 중단)
//   node scripts/policy-backup.mjs verify              사본을 다시 읽어 해시 검증
//   node scripts/policy-backup.mjs diff <시험폴더>       검증한 사본과 시험 정책의 차이만 보기
//   node scripts/policy-backup.mjs restore <시험폴더>    바뀔 항목만 보여 주고 멈춤(--yes를 붙이면 실행)
//   node scripts/policy-backup.mjs drill               임시 시험 사본에서 침공 흉내 → 차이 → 복원 → 재확인
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_DIR = join(ROOT, 'backup', 'policy');
// 안전 정책 항목: 이름 → 원본 위치. allowedRoutes는 설정 파일에서 그 값만 떼어 저장합니다.
export const POLICY_ITEMS = Object.freeze([
  { name: 'decider.mjs', source: 'src/decider.mjs' },
  { name: 'allowed-routes.json', source: 'aleph.config.json', pick: 'allowedRoutes' },
  { name: 'notes-step4-rls.sql', source: 'supabase/notes-step4-rls.sql' },
  { name: 'notes-step5-revoke.sql', source: 'supabase/notes-step5-revoke.sql' },
]);

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = message => { throw Object.assign(new Error(message), { policyStop: true }); };

export function readLivePolicy(root = ROOT) {
  return Object.fromEntries(POLICY_ITEMS.map(item => {
    const text = readFileSync(join(root, item.source), 'utf8');
    if (!item.pick) return [item.name, text];
    return [item.name, `${JSON.stringify(JSON.parse(text)[item.pick], null, 2)}\n`];
  }));
}

const manifestHash = files => sha256(Object.keys(files).sort().map(name => `${name}:${files[name]}`).join('\n'));

export function snapshot({ root = ROOT, dir = SNAPSHOT_DIR, force = false } = {}) {
  if (existsSync(join(dir, 'manifest.json')) && !force) fail('이미 사본이 있습니다. 덮어쓰지 않습니다(--force로만 새로 만듦).');
  const live = readLivePolicy(root);
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const [name, text] of Object.entries(live)) {
    writeFileSync(join(dir, name), text);
    files[name] = sha256(text);
  }
  const manifest = { schema: 'aleph.policy.snapshot.v1', version: manifestHash(files).slice(0, 12), files, manifestSha256: manifestHash(files) };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// 사본이 없거나, 파일이 빠졌거나, 해시가 하나라도 다르면 중단합니다.
export function verifySnapshot(dir = SNAPSHOT_DIR) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) fail('검증할 사본(manifest.json)이 없습니다. 중단합니다.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const names = POLICY_ITEMS.map(item => item.name).sort();
  if (JSON.stringify(Object.keys(manifest.files ?? {}).sort()) !== JSON.stringify(names)) fail('사본 목록이 안전 정책 항목과 다릅니다. 중단합니다.');
  if (manifestHash(manifest.files) !== manifest.manifestSha256) fail('manifest 해시가 맞지 않습니다. 중단합니다.');
  const texts = {};
  for (const name of names) {
    const path = join(dir, name);
    if (!existsSync(path)) fail(`사본 파일 ${name}이 없습니다. 중단합니다.`);
    texts[name] = readFileSync(path, 'utf8');
    if (sha256(texts[name]) !== manifest.files[name]) fail(`사본 ${name}의 해시가 맞지 않습니다. 중단합니다.`);
  }
  return { manifest, texts };
}

// 줄 단위 차이(앞뒤 공통 부분을 빼고 바뀐 구간만)
function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA -= 1; endB -= 1; }
  return { line: start + 1, removed: a.slice(start, endA + 1), added: b.slice(start, endB + 1) };
}

// 시험 폴더: 안전 정책 항목 이름 그대로의 파일들(+ audit.log 등 다른 파일)
export function diffPolicy(testDir, dir = SNAPSHOT_DIR) {
  const { manifest, texts } = verifySnapshot(dir);
  const changes = [];
  for (const name of Object.keys(texts).sort()) {
    const path = join(testDir, name);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === texts[name]) continue;
    changes.push({ name, missing: current === null, ...(current === null ? {} : lineDiff(texts[name], current)) });
  }
  return { version: manifest.version, changes };
}

export function formatDiff({ version, changes }) {
  if (!changes.length) return `복원할 버전 ${version}: 시험 정책이 검증한 사본과 같습니다.`;
  const lines = [`복원할 버전 ${version}: 바뀐 항목 ${changes.length}개`];
  for (const change of changes) {
    if (change.missing) { lines.push(`- ${change.name}: 파일 없음(사본으로 다시 만듦)`); continue; }
    lines.push(`- ${change.name} (${change.line}번째 줄부터)`);
    for (const text of change.removed) lines.push(`    사본: ${text}`);
    for (const text of change.added) lines.push(`    시험: ${text}`);
  }
  return lines.join('\n');
}

// 검증한 사본으로 바뀐 항목만 되돌립니다. 다른 파일과 audit.log 이력은 보존하고, 이번 복원을 한 줄 추가합니다.
export function restorePolicy(testDir, { yes = false, dir = SNAPSHOT_DIR, now = new Date() } = {}) {
  const plan = diffPolicy(testDir, dir);
  if (!yes || !plan.changes.length) return { ...plan, applied: false };
  for (const change of plan.changes) copyFileSync(join(dir, change.name), join(testDir, change.name));
  appendFileSync(join(testDir, 'audit.log'),
    `${now.toISOString()} restore version=${plan.version} items=${plan.changes.map(c => c.name).join(',')}\n`);
  const after = diffPolicy(testDir, dir);
  if (after.changes.length) fail('복원 뒤에도 차이가 남았습니다. 중단합니다.');
  return { ...plan, applied: true };
}

// 침공 흉내: 메모 구역 허용 목록에 "GET /notes"(ID 없는 전체 목록) 한 줄을 끼워 넣습니다.
export const TAMPER = Object.freeze({
  file: 'decider.mjs',
  from: "  notes: Object.freeze(['GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id']),",
  to: "  notes: Object.freeze(['GET /notes', 'GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id']),",
});

export function makeTestCopy(dir = SNAPSHOT_DIR) {
  const { texts } = verifySnapshot(dir);
  const testDir = mkdtempSync(join(tmpdir(), 'policy-test-'));
  for (const [name, text] of Object.entries(texts)) writeFileSync(join(testDir, name), text);
  writeFileSync(join(testDir, 'audit.log'), `${new Date(0).toISOString()} drill-start (기존 감사 이력 예시)\n`);
  writeFileSync(join(testDir, 'other-service.rules'), 'notices: GET only (다른 서비스 규칙 예시, 복원 대상 아님)\n');
  return testDir;
}

export function tamper(testDir) {
  const path = join(testDir, TAMPER.file);
  const text = readFileSync(path, 'utf8');
  if (!text.includes(TAMPER.from)) fail('침공 흉내를 넣을 줄을 찾지 못했습니다.');
  writeFileSync(path, text.replace(TAMPER.from, TAMPER.to));
}

async function deciderVerdicts(testDir) {
  const { decide } = await import(`${pathToFileURL(join(testDir, 'decider.mjs')).href}?v=${Date.now()}${Math.random()}`);
  const { fixtureRequests } = await import('./fixture-7.mjs');
  const { normal } = fixtureRequests();
  const ask = async (path, route) => (await decide({ ...normal, path, route })).decision;
  return { list: await ask('/notes', 'GET /notes'), own: await ask('/notes/demo', 'GET /notes/:id') };
}

export async function drill(log = text => process.stdout.write(`${text}\n`)) {
  const { manifest } = verifySnapshot();
  log(`1) 사본 검증 통과: 버전 ${manifest.version} (manifest ${manifest.manifestSha256.slice(0, 16)}…)`);
  const testDir = makeTestCopy();
  try {
    tamper(testDir);
    const tampered = await deciderVerdicts(testDir);
    log(`2) 시험 사본에 침공 흉내: 메모 전체 목록 GET /notes → ${tampered.list}`);
    log(`3) 실행 전 차이\n${formatDiff(diffPolicy(testDir))}`);
    const dry = restorePolicy(testDir);
    log(`4) 확인 없이 restore: 적용 ${dry.applied ? '됨' : '안 됨'}(바뀔 항목 ${dry.changes.length}개만 표시)`);
    restorePolicy(testDir, { yes: true });
    const restored = await deciderVerdicts(testDir);
    const audit = readFileSync(join(testDir, 'audit.log'), 'utf8').trim().split('\n');
    const other = existsSync(join(testDir, 'other-service.rules'));
    log(`5) --yes 복원 뒤: 메모 전체 목록 → ${restored.list}, 자기 메모 ID 읽기 → ${restored.own}`);
    log(`6) 감사 이력 ${audit.length}줄 보존(기존 1줄 + 복원 1줄), 다른 서비스 규칙 파일 ${other ? '보존' : '사라짐'}, 남은 차이 ${diffPolicy(testDir).changes.length}개`);
    return { tampered, restored, auditLines: audit.length, otherKept: other };
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target] = process.argv.slice(2);
  const yes = process.argv.includes('--yes');
  try {
    if (command === 'snapshot') {
      const m = snapshot({ force: process.argv.includes('--force') });
      process.stdout.write(`사본 생성: 버전 ${m.version}\n${Object.entries(m.files).map(([n, h]) => `- ${n} ${h}`).join('\n')}\n`);
    } else if (command === 'verify') {
      const { manifest } = verifySnapshot();
      const live = readLivePolicy();
      const drift = Object.keys(live).filter(name => live[name] !== readFileSync(join(SNAPSHOT_DIR, name), 'utf8'));
      process.stdout.write(`사본 검증 통과: 버전 ${manifest.version}\n현재 운영 정책과 다른 항목: ${drift.length ? drift.join(', ') : '없음'}\n`);
    } else if (command === 'diff' && target) {
      process.stdout.write(`${formatDiff(diffPolicy(resolve(target)))}\n`);
    } else if (command === 'restore' && target) {
      const result = restorePolicy(resolve(target), { yes });
      process.stdout.write(`${formatDiff(result)}\n${result.applied ? '복원 완료(audit.log에 기록)' : '실행하지 않았습니다. 확인 후 --yes를 붙여 다시 실행하세요.'}\n`);
    } else if (command === 'drill') {
      await drill();
    } else {
      process.stdout.write('사용법: snapshot | verify | diff <시험폴더> | restore <시험폴더> [--yes] | drill\n');
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`정책 도구 중단: ${error.policyStop ? error.message : '예상하지 못한 오류'}\n`);
    process.exitCode = 1;
  }
}
