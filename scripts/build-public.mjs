import { readFile, rm, writeFile } from 'node:fs/promises';
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

// 5단계: 로그인은 서버 함수(/api/auth/*)가 맡습니다. 화면에는 Supabase 주소·공개 키·브라우저 SDK를 내보내지 않고,
// 이전 빌드가 남긴 파일도 지웁니다.
await rm(resolve(root, 'public', 'auth-config.json'), { force: true });
await rm(resolve(root, 'public', 'vendor'), { recursive: true, force: true });
console.log('화면에 Supabase 공개 키와 브라우저 SDK를 내보내지 않습니다. 로그인은 /api/auth 서버 함수가 처리합니다.');

if (!local) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
