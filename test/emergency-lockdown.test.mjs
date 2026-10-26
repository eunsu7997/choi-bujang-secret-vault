import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler } from '../api/notes.js';

// The parent commit's unconditional maintenance gate is replaced by authenticated read-only service.
for (const method of ['GET','POST','PATCH','DELETE','HEAD','OPTIONS']) {
  test(`auth release refuses unauthenticated ${method} before store access`, async () => {
    let status; let accessed = false;
    const handler = createNotesHandler({getVerifier:()=>async()=>null,getStore:()=>{accessed=true;throw Error('store');}});
    await handler({method,headers:{}},{setHeader(){},status(value){status=value;return {json(){}};}});
    assert.equal(status, ['HEAD','OPTIONS'].includes(method)?405:401);
    assert.equal(accessed,false);
  });
}
test('B-3 deployment enables only student writes', async () => {
  const source=await readFile(new URL('../api/notes.js',import.meta.url),'utf8');
  assert.match(source.slice(source.indexOf('export default createNotesHandler')),/writesEnabled: 'students-only'/u);
});
test('B-1 deployment never reads a write-enable environment switch', async () => {
  const source=await readFile(new URL('../api/notes.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/process\.env\.[A-Z_]*WRITE/u);
});
