import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createNotesHandler,supabaseNotesStore} from '../api/notes.js';
import {call,fakeSupabase,studentBearer,verify} from './helpers/auth-fixture.mjs';
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222';
async function setup(){const db=fakeSupabase();return {db,h:createNotesHandler({getVerifier:()=>verify,getStore:()=>supabaseNotesStore(db),writesEnabled:'students-only'}), ah:{authorization:await studentBearer(a)},bh:{authorization:await studentBearer(b)}};}
test('official wire contract: generated/supplied UUID, direct arrays and objects, PUT and delete GET404',async()=>{
 const {db,h,ah,bh}=await setup();
 const supplied='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
 for(const id of [undefined,supplied]){
  const c=await call(h,{method:'POST',headers:ah,url:'/api/notes',body:{...(id?{id}:{}),title:'synthetic',body:'text'}});
  assert.equal(c.status,201);assert.deepEqual(Object.keys(c.body),['id']);const path=`/api/notes/${c.body.id}`;
  assert.match(c.body.id,/^[a-f0-9-]{36}$/);if(id)assert.equal(c.body.id,id.toLowerCase());
  const get=await call(h,{method:'GET',headers:ah,url:path});assert.deepEqual(get.body,{id:c.body.id,title:'synthetic',body:'text'});
  assert.equal(get.status,200);const before=JSON.stringify(db.rows);
  for(const method of ['GET','PUT','DELETE'])assert.equal((await call(h,{method,headers:bh,url:path,body:{title:'foreign',body:''}})).status,404);
  assert.equal(JSON.stringify(db.rows),before);
  const put=await call(h,{method:'PUT',headers:ah,url:path,body:{title:'changed',body:'new'}});assert.deepEqual([put.status,put.body],[200,{id:c.body.id,title:'changed',body:'new'}]);
  const list=await call(h,{method:'GET',headers:ah,url:'/api/notes'});assert.deepEqual(list.body,[put.body]);
  const del=await call(h,{method:'DELETE',headers:ah,url:path});assert.equal(del.status,204);assert.equal(del.body,undefined);
  assert.equal((await call(h,{method:'GET',headers:ah,url:path})).status,404);
 }assert.equal(db.rows.length,0);
});
test('supplied ID conflicts never overwrite own/foreign rows, including concurrent creates',async()=>{
 const {db,h,ah,bh}=await setup();const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',body={id,title:'synthetic',body:'text'};
 const results=await Promise.all([call(h,{method:'POST',headers:ah,body}),call(h,{method:'POST',headers:ah,body})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const before=JSON.stringify(db.rows);const r=await call(h,{method:'POST',headers:bh,body:{...body,title:'overwrite'}});assert.deepEqual([r.status,r.body],[409,{error:'NOTE_ID_CONFLICT'}]);assert.equal(JSON.stringify(db.rows),before);
});
test('malformed paths and conflicting rewrite IDs cannot fall back to collection access',async()=>{
 const {db,h,ah}=await setup();const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const url of ['/unknown','/api/notes/%ZZ','/api/notes/a%2fb',`/api/notes/${id}?id=${b}`,`/api/notes?id=${id}&id=${id}`])assert.deepEqual([(await call(h,{method:'GET',headers:ah,url})).status,db.calls.length],[400,0]);
 assert.equal((await call(h,{method:'PATCH',headers:ah})).status,405);
 assert.equal((await call(h,{method:'PUT',headers:ah,body:{title:'x',body:''}})).status,400);
 assert.equal((await call(h,{method:'POST',headers:ah,url:`/api/notes/${id}`,body:{title:'x',body:''}})).status,405);
});
test('canonical item routes are included in Vercel rewrite and allowlist',async()=>{
 const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
 assert.deepEqual((await read('../vercel.json')).rewrites,[{source:'/api/notes/:id',destination:'/api/notes?id=:id'},{source:'/api/auth/:action',destination:'/api/notes?auth=:action'}]);
 assert.deepEqual((await read('../aleph.config.json')).allowedRoutes,['/api/notes','/api/notes/:id','/api/auth/login','/api/auth/session','/api/auth/logout']);
});
