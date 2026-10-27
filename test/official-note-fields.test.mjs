import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFields, publicNote } from '../src/notes-contract.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('public note has exactly id/title/body and does not expose owner or content',()=>{
 assert.deepEqual(publicNote({id,title:'fixture',content:'text',owner_id:'private',owner_kind:'student'}),{id,title:'fixture',body:'text'});
});
test('POST accepts supplied UUID or generates a fresh UUID without changing SQL content column',()=>{
 assert.deepEqual(createFields({id:id.toUpperCase(),title:'fixture',body:'text'}),{id,title:'fixture',content:'text'});
 const a=createFields({title:'fixture',body:''}),b=createFields({title:'fixture',body:''});
 assert.match(a.id,/^[a-f0-9-]{36}$/u);assert.notEqual(a.id,b.id);assert.equal(a.content,'');
});
test('owner injection, old field names and invalid supplied IDs are refused',()=>{
 for(const input of[{id:'invalid',title:'x',body:''},{id:null,title:'x',body:''},{title:'x',content:'old'},{title:'x',body:'',owner_id:id},{title:'x',body:'',owner_kind:'judge'},null,[]])assert.equal(createFields(input),null);
});
