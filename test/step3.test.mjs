import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const authConfigPath = new URL('public/auth-config.json', root);
// 시험용 가짜 값입니다. 실제 프로젝트 주소나 키가 아닙니다.
const fakeUrl = 'https://abc.supabase.co';
// 비밀 스캐너가 오탐하지 않도록 키 모양 문자열을 소스에 그대로 두지 않습니다.
const fakePublishable = ['sb', 'publishable', 'TESTONLY', '0123456789'].join('_');
const fakeSecret = ['sb', 'secret', 'TESTONLY', '0123456789'].join('_');

// 학생이 브라우저 시험용으로 만든 로컬 설정을 시험 전후로 그대로 되돌립니다. 내용은 출력하지 않습니다.
// 강제 종료·겹친 실행에도 원본을 잃지 않도록 저장소 밖 임시 폴더에 파일로 백업합니다.
// 시험이 쓰는 파일에는 모두 TESTONLY 표지가 있어 진짜 설정과 구분합니다.
const backupPath = join(tmpdir(), `aleph-auth-config-${createHash('sha256')
  .update(fileURLToPath(root)).digest('hex').slice(0, 12)}.json`);
const isFixture = (path) => existsSync(path) && readFileSync(path, 'utf8').includes('TESTONLY');
let savedAuthConfig = null;
before(() => {
  if (existsSync(authConfigPath) && !isFixture(authConfigPath)) copyFileSync(authConfigPath, backupPath);
  else if (existsSync(backupPath)) copyFileSync(backupPath, authConfigPath);
  savedAuthConfig = existsSync(backupPath) ? readFileSync(backupPath) : null;
});
after(() => {
  const saved = existsSync(backupPath) ? readFileSync(backupPath) : savedAuthConfig;
  if (saved) writeFileSync(authConfigPath, saved);
  else rmSync(authConfigPath, { force: true });
  rmSync(backupPath, { force: true });
});

function build(env, args = ['--local']) {
  const clean = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('SUPABASE_') && !key.startsWith('VERCEL_')));
  return spawnSync(process.execPath, ['scripts/build-public.mjs', ...args],
    { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' });
}

test('build publishes no Supabase key or browser SDK and removes stale copies', async () => {
  const vendorDir = new URL('public/vendor/', root);
  for (const env of [{ SUPABASE_URL: `${fakeUrl}/`, SUPABASE_PUBLISHABLE_KEY: fakePublishable, SUPABASE_SECRET_KEY: fakeSecret }, {}]) {
    writeFileSync(authConfigPath, '{"TESTONLY":"stale"}\n');
    const result = build(env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(authConfigPath), false);
    assert.equal(existsSync(vendorDir), false);
    assert.doesNotMatch(result.stdout + result.stderr, /TESTONLY|sb_publishable_|sb_secret_/u);
  }
});

test('page logs in through the server function and never holds Supabase keys or tokens', async () => {
  const page = await read('public/index.html');
  assert.match(page, /fetch\('\/api\/auth\/login'/u);
  assert.match(page, /fetch\('\/api\/auth\/session'/u);
  assert.match(page, /fetch\('\/api\/auth\/logout'/u);
  assert.doesNotMatch(page, /vendor\/supabase|auth-config|createClient|sb_publishable_|sb_secret_|service_role|SUPABASE_|access_token|refresh_token|localStorage|innerHTML|cdn\.|https?:\/\//u);
  assert.match(page, /if \(turn !== renderTurn\) return;/u);
  // .auth form의 display: grid가 hidden 속성을 덮어써 로그인 뒤에도 폼이 보이던 회귀를 막습니다.
  assert.match(page, /\.auth \[hidden\] \{ display: none; \}/u);
  assert.ok(page.indexOf('.auth [hidden]') > page.indexOf('.auth form {'));
  assert.match(page, /<form id="login-form" hidden>/u);
  assert.match(page, /form\.hidden = Boolean\(session\);/u);
});

test('generated public files stay out of Git', () => {
  const result = spawnSync('git', ['check-ignore', 'public/auth-config.json', 'public/vendor/supabase.js'],
    { cwd: root, encoding: 'utf8' });
  assert.deepEqual(result.stdout.trim().split(/\r?\n/u), ['public/auth-config.json', 'public/vendor/supabase.js']);
});

test('vercel.json forbids framing on every path', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  const rule = vercel.headers.find((item) => item.source === '/(.*)');
  const value = (key) => rule.headers.filter((item) => item.key === key).map((item) => item.value);
  assert.deepEqual(value('Content-Security-Policy'), ["frame-ancestors 'none'"]);
  assert.deepEqual(value('X-Frame-Options'), ['DENY']);
  assert.deepEqual(value('X-Content-Type-Options'), ['nosniff']);
});
