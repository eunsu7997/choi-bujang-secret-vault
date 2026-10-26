// 2단계: 가상 메모를 Supabase에서 서버 전용 키로 읽어 돌려줍니다.
// 아직 로그인 확인이 없어 누구나 호출할 수 있습니다. 3단계에서 막습니다.
import { createClient } from '@supabase/supabase-js';

const MAX_NOTES = 50;
let cachedClient;

export function supabaseFromEnv(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (typeof url !== 'string' || typeof key !== 'string' || !key.trim() || key !== key.trim()) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  cachedClient ??= createClient(parsed.origin, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return cachedClient;
}

export function createNotesHandler(getClient) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const client = getClient();
    if (!client) return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
    try {
      const { data, error } = await client.from('notes').select('title, content')
        .order('created_at', { ascending: true }).limit(MAX_NOTES);
      if (error || !Array.isArray(data)) throw Object.assign(new Error('query'), { code: error?.code });
      // owner_id·id는 화면에 필요 없으므로 내보내지 않습니다.
      const notes = data.map(({ title, content }) => ({ title, content }));
      return response.status(200).json({ notes });
    } catch (error) {
      // 오류 코드만 남기고 키·주소·메모 본문은 기록하지 않습니다.
      console.error('notes_query_failed', typeof error?.code === 'string' ? error.code : 'unknown');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createNotesHandler(() => supabaseFromEnv());
