import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

// Runs the actual page script in a minimal isolated DOM; no browser, server or DB.
async function page() {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gu)].at(-1)[1];
  const elements = new Map();
  class Element {
    constructor(tag = '') { this.tag = tag; this.children = []; this.events = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.classList = { add() {}, remove() {} }; }
    addEventListener(name, fn) { this.events[name] = fn; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    querySelector(key) { return get(this.tag + ' ' + key); }
    reset() { get('#note-title').value = ''; get('#note-content').value = ''; }
    focus() {}
    fire(name) { return this.events[name]?.({ preventDefault() {}, currentTarget: this }); }
  }
  function get(key) { if (!elements.has(key)) elements.set(key, new Element(key)); return elements.get(key); }
  const pending = [];
  const timers = [];
  let listener;
  let failLogin = false;
  const context = {
    document: { querySelector: get, createElement: tag => new Element(tag) },
    window: { supabase: { createClient: () => ({ auth: {
      onAuthStateChange(fn) { listener = fn; },
      async signInWithPassword() { if (failLogin) throw new Error('synthetic'); return { error: null }; },
      async signOut() { listener('SIGNED_OUT', null); return { error: null }; },
    } }) } },
    fetch: async (url, init = {}) => {
      if (url === '/auth-config.json') return { ok: true, json: async () => ({ supabaseUrl: 'synthetic', publishableKey: 'synthetic' }) };
      return new Promise(resolve => pending.push({ url, init, resolve }));
    },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    sessionStorage: { getItem() {}, removeItem() {}, setItem() {} }, localStorage: {},
    location: { reload() {} },
  };
  await vm.runInNewContext(`(async () => {${script}\n})()`, context);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const session = id => ({ user: { id }, access_token: 'synthetic-' + id });
  const auth = async id => { listener('CHANGED', id ? session(id) : null); while (timers.length) timers.shift()(); await flush(); };
  const reply = async (request, notes = [], status = 200) => { request.resolve({ ok: status < 400, status, json: async () => ({ notes }) }); await flush(); };
  const list = () => get('#notes');
  return { get, pending, auth, reply, flush, list, failLogin: () => { failLogin = true; } };
}

test('account switch immediately clears prior memo text and ignores the prior account response', async () => {
  const p = await page();
  await p.auth('A'); const first = p.pending.at(-1);
  await p.reply(first, [{ id: 'a', title: 'A private', content: 'A body' }]);
  // The real list selector is #notes; assert the page exposes the synthetic row.
  assert.equal(p.list().children[0].children[0].textContent, 'A private');
  await p.auth('A'); const old = p.pending.at(-1);
  await p.auth('B'); const fresh = p.pending.at(-1);
  assert.equal(p.list().children[0].textContent, '메모를 불러오는 중입니다.');
  await p.reply(fresh, [{ id: 'b', title: 'B own', content: '' }]);
  await p.reply(old, [{ id: 'a', title: 'STALE A', content: '' }]);
  assert.equal(p.list().children[0].children[0].textContent, 'B own');
});

test('overlapping same-account list responses keep the latest result and render XSS as text', async () => {
  const p = await page();
  await p.auth('A'); const old = p.pending.at(-1);
  await p.auth('A'); const fresh = p.pending.at(-1);
  const attack = '<img src=x onerror=alert(1)>';
  await p.reply(fresh, [{ id: 'a', title: attack, content: '<script>attack()</script>' }]);
  await p.reply(old, [{ id: 'b', title: 'OLD', content: '' }]);
  assert.equal(p.list().children[0].children[0].textContent, attack);
  assert.equal(p.list().children[0].children[1].textContent, '<script>attack()</script>');
});

test('in-flight create cannot overwrite another account editor and logout clears rows', async () => {
  const p = await page();
  await p.auth('A'); await p.reply(p.pending.at(-1));
  p.get('#note-title').value = 'new';
  const save = p.get('#note-form').fire('submit'); const request = p.pending.at(-1);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer synthetic-A');
  await p.auth('B'); await p.reply(p.pending.at(-1));
  p.get('#note-title').value = 'B draft';
  await p.reply(request, [], 201); await save;
  assert.equal(p.get('#note-title').value, 'B draft');
  assert.equal(p.get('#note-status').textContent, '');
  await p.get('#logout').fire('click'); await p.auth(null);
  assert.equal(p.get('#editor-section').hidden, true);
  assert.equal(p.list().children[0].textContent, '로그인하면 가상 메모를 볼 수 있습니다.');
});

test('login network errors clear password and re-enable the button', async () => {
  const p = await page(); p.failLogin();
  p.get('#login-form #password').value = 'synthetic-only';
  await p.get('#login-form').fire('submit');
  assert.equal(p.get('#login-form #password').value, '');
  assert.equal(p.get('#login-form button').disabled, false);
  assert.match(p.get('#auth-status').textContent, /로그인에 실패/u);
});
