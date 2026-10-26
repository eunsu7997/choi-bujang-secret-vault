import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const local = process.argv.includes('--local');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 2) {
  throw new Error('2단계부터는 메모를 서버 API(/api/notes)로만 전달합니다. aleph.config.json의 step을 확인하세요.');
}
// 1단계의 공개 사본이 남아 있으면 배포에 섞이지 않도록 지웁니다.
await rm(resolve(root, 'public', 'data.json'), { force: true });
console.log('공개 data.json을 만들지 않습니다. 메모는 /api/notes에서 읽습니다.');

// 브라우저 로그인에는 공개용 주소와 publishable 키만 내보냅니다. 서버 전용 키는 절대 쓰지 않습니다.
function browserAuthConfig(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined && key === undefined) return null;
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SUPABASE_URL 형식을 확인하세요. https://<프로젝트>.supabase.co 형태여야 합니다.');
  }
  if (typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/u.test(key)
      || key === env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY에는 공개용 publishable 키만 넣으세요. 서버 전용 키는 화면에 내보내지 않습니다.');
  }
  return { supabaseUrl: parsed.origin, publishableKey: key };
}

const authConfigPath = resolve(root, 'public', 'auth-config.json');
// 로컬 실행에 설정값이 아예 없으면 학생이 만든 로컬 설정을 그대로 둡니다.
const keepLocalAuthConfig = local && process.env.SUPABASE_URL === undefined
  && process.env.SUPABASE_PUBLISHABLE_KEY === undefined;
if (keepLocalAuthConfig) {
  console.log('로컬 실행: 새 로그인 공개 설정이 없어 기존 public/auth-config.json(있다면)을 그대로 둡니다.');
} else {
  // 검증이 실패해도 이전 공개 설정이 남지 않도록 먼저 지웁니다.
  await rm(authConfigPath, { force: true });
  const authConfig = browserAuthConfig(process.env);
  if (!authConfig) {
    throw new Error('Vercel 환경변수 SUPABASE_PUBLISHABLE_KEY를 등록하세요. 로그인 화면에 필요합니다.');
  }
  await writeFile(authConfigPath, `${JSON.stringify(authConfig, null, 2)}\n`, 'utf8');
  console.log('로그인 공개 설정을 public/auth-config.json에 기록했습니다.');
}

// 잠금 파일에 고정된 supabase-js 브라우저 번들을 같은 출처에서 제공합니다.
const require = createRequire(import.meta.url);
const supabaseBundle = resolve(require.resolve('@supabase/supabase-js'), '..', 'umd', 'supabase.js');
await mkdir(resolve(root, 'public', 'vendor'), { recursive: true });
await copyFile(supabaseBundle, resolve(root, 'public', 'vendor', 'supabase.js'));

if (!local) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
