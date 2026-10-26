import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import handler from '../api/notes.js';

for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
  test(`maintenance gate refuses ${method} without inspecting request data`, () => {
    const headers = new Map();
    let status;
    let body;
    const request = new Proxy({}, { get() { throw new Error('Request contents must not be read'); } });
    handler(request, {
      setHeader: (key, value) => headers.set(key, value),
      status(code) { status = code; return { json(value) { body = value; } }; },
    });
    assert.equal(status, 503);
    assert.deepEqual(body, { error: 'NOTES_TEMPORARILY_UNAVAILABLE' });
    assert.equal(headers.get('Cache-Control'), 'no-store, max-age=0');
    assert.equal(headers.get('Retry-After'), '3600');
  });
}

test('gate cannot read credentials, authenticate, fetch or access the database', async () => {
  const source = await readFile(new URL('../api/notes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|process\.env|\bfetch\s*\(|createClient|\.from\s*\(|\.select\s*\(/u);
});

test('maintenance response is independent of supplied credentials and query IDs', () => {
  for (const headers of [{}, { authorization: 'Bearer synthetic-invalid' }]) {
    let result;
    handler({ method: 'GET', headers, query: { id: 'synthetic' } }, {
      setHeader() {}, status(code) { return { json(body) { result = { code, body }; } }; },
    });
    assert.deepEqual(result, { code: 503, body: { error: 'NOTES_TEMPORARILY_UNAVAILABLE' } });
  }
});
