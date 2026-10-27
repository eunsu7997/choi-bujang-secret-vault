// 소유권 시험용 로그인 도우미입니다. 모두 임시 키와 가짜 주소이며 외부 네트워크로 나가지 않습니다.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createLoginVerifier } from '../../src/verify-login.mjs';

const realConfig = JSON.parse(await readFile(new URL('../../aleph.config.json', import.meta.url), 'utf8'));
const studentIssuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const appHost = 'student-defense.vercel.app';
const config = {
  judgeIssuer: realConfig.judgeIssuer,
  publicAppUrl: `https://${appHost}/`,
  identityProvider: { issuer: studentIssuer, audience: 'authenticated', jwksUrl: `${studentIssuer}/.well-known/jwks.json` },
};

const studentKeys = await generateKeyPair('ES256');
const judgeKeys = await generateKeyPair('ES256');
const studentJwk = { ...(await exportJWK(studentKeys.publicKey)), kid: 'student-kid', alg: 'ES256', use: 'sig' };
const judgeJwk = { ...(await exportJWK(judgeKeys.publicKey)), kid: 'judge-kid', alg: 'ES256', use: 'sig' };

async function fakeFetch(input) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.origin !== new URL(studentIssuer).origin) throw new Error('unexpected host');
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return Response.json({ keys: [studentJwk] });
  return Response.json({ code: 401, msg: 'invalid JWT' }, { status: 401 });
}

export const verify = createLoginVerifier({
  config,
  supabaseClient: createClient(new URL(studentIssuer).origin, 'test-only-not-a-key', {
    global: { fetch: fakeFetch },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }),
  judgeKeySet: createLocalJWKSet({ keys: [judgeJwk] }),
});

export async function studentBearer(sub) {
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'student-kid', typ: 'JWT' })
    .setIssuer(studentIssuer).setAudience('authenticated').setSubject(sub)
    .setIssuedAt().setExpirationTime('10m').sign(studentKeys.privateKey);
  return `Bearer ${token}`;
}

export async function judgeBearer(sub, identity) {
  const token = await new SignJWT({ aleph_run: randomUUID(), aleph_role: 'judge', aleph_identity: identity })
    .setProtectedHeader({ alg: 'ES256', kid: 'judge-kid', typ: 'JWT' })
    .setIssuer(realConfig.judgeIssuer).setAudience(appHost).setSubject(sub)
    .setIssuedAt().setExpirationTime('10m').sign(judgeKeys.privateKey);
  return `Bearer ${token}`;
}

// supabaseNotesStore가 실제로 거는 필터를 메모리 행에 그대로 적용하는 PostgREST 흉내입니다.
export function fakeSupabase(rows = [], { ignoreOwnerFilters = false, missingColumn = null } = {}) {
  const calls = [];
  const pick = (row, columns) => (columns
    ? Object.fromEntries(columns.split(',').map((name) => name.trim()).map((name) => [name, row[name]]))
    : { ...row });
  function run(state) {
    calls.push({ op: state.op, filters: state.filters.map(([column]) => column) });
    if (missingColumn && state.columns?.includes(missingColumn)) return { data: null, error: { code: '42703' } };
    // ignoreOwnerFilters는 소유자 조건이 새는 DB를 흉내 내어 점검 도구가 이를 잡는지 시험합니다.
    const active = ignoreOwnerFilters ? state.filters.filter(([column]) => !column.startsWith('owner_')) : state.filters;
    const match = (row) => active.every(([column, value]) => (Array.isArray(value) && column.endsWith(':in')
      ? value.includes(row[column.slice(0, -3)]) : row[column] === value));
    let out;
    if (state.op === 'insert') {
      if (rows.some(row => row.id === state.payload.id)) return { data: null, error: { code: '23505' } };
      const row = { id: randomUUID(), created_at: rows.length, ...state.payload };
      rows.push(row);
      out = [row];
    } else if (state.op === 'select') {
      out = rows.filter(match);
    } else if (state.op === 'update') {
      out = rows.filter(match);
      for (const row of out) Object.assign(row, state.payload);
    } else {
      out = rows.filter(match);
      for (const row of out) rows.splice(rows.indexOf(row), 1);
    }
    const data = out.map((row) => pick(row, state.columns));
    if (state.single) return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116' } };
    if (state.maybe) return data.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
  return {
    rows,
    calls,
    from(table) {
      if (table !== 'notes') throw new Error('unexpected table');
      const state = { op: 'select', filters: [], payload: null, columns: null, single: false, maybe: false };
      const query = {
        select(columns) { state.columns = columns; return query; },
        insert(payload) { state.op = 'insert'; state.payload = payload; return query; },
        update(payload) { state.op = 'update'; state.payload = payload; return query; },
        delete() { state.op = 'delete'; return query; },
        eq(column, value) { state.filters.push([column, value]); return query; },
        in(column, values) { state.filters.push([`${column}:in`, values]); return query; },
        order() { return query; },
        limit() { return query; },
        single() { state.single = true; return query; },
        maybeSingle() { state.maybe = true; return query; },
        then(resolve, reject) { return Promise.resolve().then(() => run(state)).then(resolve, reject); },
      };
      return query;
    },
  };
}

export function call(handler, request) {
  const headers = new Map();
  let status;
  let body;
  const response = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    status: (value) => { status = value; return { json: (value) => { body = value; }, end: () => {} }; },
  };
  return handler({ headers: {}, query: {}, ...request }, response).then(() => ({ status, body, headers }));
}
