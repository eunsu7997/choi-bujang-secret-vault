import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { call, fakeSupabase, studentBearer, judgeBearer, verify } from './helpers/auth-fixture.mjs';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';

test('student release allows own CRUD while foreign GET/PUT/DELETE remain indistinguishable 404',async()=>{
 const db=fakeSupabase();
 const handler=createNotesHandler({getVerifier:()=>verify,getStore:()=>supabaseNotesStore(db),writesEnabled:'students-only'});
 const ah={authorization:await studentBearer(a)},bh={authorization:await studentBearer(b)};
 const created=await call(handler,{method:'POST',headers:ah,body:{title:'synthetic',body:''}});
 assert.equal(created.status,201);const id=created.body.id;
 assert.equal((await call(handler,{method:'GET',headers:ah,query:{id}})).status,200);
 for(const method of ['GET','PUT','DELETE']){
  const r=await call(handler,{method,headers:bh,query:{id},body:{title:'attempt',body:''}});
  assert.deepEqual([r.status,r.body],[404,{error:'NOTE_NOT_FOUND'}]);
 }
 assert.equal((await call(handler,{method:'PUT',headers:ah,query:{id},body:{title:'synthetic',body:'updated'}})).status,200);
 assert.equal((await call(handler,{method:'DELETE',headers:ah,query:{id}})).status,204);
 assert.equal(db.rows.length,0);
});

test('student-only mode denies every verified judge write before store access but preserves judge reads',async()=>{
 const authorization=await judgeBearer(a,'a');let calls=0;
 const handler=createNotesHandler({getVerifier:()=>verify,getStore:()=>{calls++;return {list:async()=>[]};},writesEnabled:'students-only'});
 for(const method of ['POST','PUT','DELETE']){
  const r=await call(handler,{method,headers:{authorization},body:{title:'attempt',body:''},query:{id:b}});
  assert.deepEqual([r.status,r.body],[403,{error:'WRITES_DISABLED'}]);
 }
 assert.equal(calls,0);
 assert.equal((await call(handler,{method:'GET',headers:{authorization}})).status,200);
 assert.equal(calls,1);
});

test('unknown truthy write modes fail closed and anonymous writes are always 401',async()=>{
 for(const writesEnabled of ['true','all',{},false]){
  let accessed=false;
  const handler=createNotesHandler({getVerifier:()=>verify,getStore:()=>{accessed=true;return {};},writesEnabled});
  const r=await call(handler,{method:'POST',headers:{authorization:await studentBearer(a)},body:{title:'attempt',body:''}});
  assert.equal(r.status,403);assert.equal(accessed,false);
 }
 const handler=createNotesHandler({getVerifier:()=>verify,getStore:()=>{throw Error('must not access');},writesEnabled:'students-only'});
 assert.equal((await call(handler,{method:'POST',headers:{},body:{title:'attempt',body:''}})).status,401);
});
