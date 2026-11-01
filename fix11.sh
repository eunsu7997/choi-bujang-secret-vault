set -e
git checkout -- .
git apply --whitespace=nowarn <<'EOF11B'
diff --git a/README.md b/README.md
index 64a76de..47f7155 100644
--- a/README.md
+++ b/README.md
@@ -11,6 +11,7 @@
   - 승인: 「승인 요청」 버튼은 대기(pending) 행만 만듭니다(서버 권한은 읽기·추가뿐, 추가 행은 트리거로 pending만 허용). 본문에 `approved`를 넣어도 무시됩니다. 승인은 계정 주인이 Supabase SQL Editor에서 `supabase/device-approve.sql`(내 이메일 + 화면의 승인 코드, 대기 중인 한 대만)로만 합니다. 취소는 같은 조건으로 `revoked`.
   - 경로: `GET /api/device/status`, `POST /api/device/request`(`vercel.json` rewrite → `api/notes.js`). 둘 다 로그인 필수(비로그인 401), 쿠키 POST는 같은 출처만.
   - 기존 결과 유지: 비로그인 401, 위조 토큰 401, 소유자 검사(남의 메모 404), 공지·관리·복원 경로는 그대로입니다. Authorization 헤더(심판·자동 점검) 경로의 기기 확인은 반 엔진·판정기(6단계 `device_registered`)가 맡고, 서버 화면 경로의 기기 승인과는 따로입니다. 기기 기록을 확인할 수 없으면(테이블 없음 등) 거부합니다.
+- 11단계 보완(심판 S11_DATA_BEFORE_APPROVAL 반영): 화면이 로그인 직후·「승인 다시 확인」·온라인 복귀 때 먼저 `GET /api/device/status`를 묻고, 서버 응답이 `approved: true`(state `approved`)일 때만 메모를 요청합니다. 미승인·확인 실패면 메모를 요청하지 않고 승인 안내만 보여 주며, 쓰기 화면도 자료를 받은 뒤에만 엽니다.
 - 운영 적용(학생이 직접): ① Supabase SQL Editor에서 `supabase/device-approvals.sql` 실행(마지막 확인 결과 `rls_forced=true`, `public_grants=0`, `server_grants=INSERT,SELECT`) ② 배포된 화면에서 로그인 → 「이 기기 승인 요청」 → 승인 코드 확인 ③ `supabase/device-approve.sql`의 이메일·코드 두 값을 SQL Editor에서만 바꿔 실행 ④ 화면에서 「승인 다시 확인」 → 기존 메모 화면이 열림. ①을 하기 전에는 브라우저 화면에서 메모가 열리지 않습니다(실패 시 닫힘).
 - 확인: `node --test --test-concurrency=1 test/*.test.mjs`(`test/step11-device-app.test.mjs`: 승인 전 403·버튼은 pending만·승인 뒤 정상·다른 기기 차단·헤더 경로 유지·저장소 오류 시 거부·manifest/서비스 워커 검사, `test/ui-security.test.mjs`: 실제 화면 코드에서 승인 전 자료 없음·승인 뒤 기존 화면). 로그인 쿠키가 필요한 운영 확인(승인 전 자료 없음, 승인한 기기의 기존 화면)은 **미실행**이며 위 운영 적용 순서로 직접 확인합니다. 서명 위조(서명 뒤 경로·본문 변경, 서명 없는 요청)는 반 엔진의 기기 서명 검증 범위로, 이 저장소에서 실측하지 않았습니다.
 
diff --git a/public/index.html b/public/index.html
index 4e37d93..07fbcad 100644
--- a/public/index.html
+++ b/public/index.html
@@ -244,16 +244,37 @@
       deviceStatus.textContent = DEVICE_STATES[data?.state] ?? '승인 상태를 확인할 수 없습니다. 잠시 뒤 다시 시도하세요.';
     }
 
-    async function showDeviceGate() {
+    // 서버에 이 기기의 승인 상태를 묻습니다. 실패하면 null(승인 안 됨으로 취급)입니다.
+    async function fetchDeviceStatus() {
+      try {
+        const response = await fetch('/api/device/status', { cache: 'no-store', credentials: 'same-origin' });
+        return response.ok ? await response.json() : null;
+      } catch { return null; }
+    }
+
+    // 승인 전 화면: 자료와 쓰기 화면을 숨기고 승인 안내만 보여 줍니다.
+    async function showDeviceGate(known) {
       const gen = sessionGen;
       editorSection.hidden = true;
       deviceSection.hidden = false;
       showMessage('이 기기는 아직 승인되지 않아 자료를 표시하지 않습니다.');
-      try {
-        const response = await fetch('/api/device/status', { cache: 'no-store', credentials: 'same-origin' });
-        const data = response.ok ? await response.json() : null;
-        if (gen === sessionGen) showDeviceState(data);
-      } catch { if (gen === sessionGen) showDeviceState(null); }
+      const data = known === undefined ? await fetchDeviceStatus() : known;
+      if (gen === sessionGen) showDeviceState(data);
+    }
+
+    // 11단계: 먼저 서버의 기기 승인 상태를 확인하고, approved=true일 때만 메모를 요청합니다.
+    // 미승인·확인 실패면 메모를 요청하지 않고 승인 안내만 보여 줍니다.
+    async function openIfApproved(session, turn) {
+      const gen = sessionGen;
+      editorSection.hidden = true;
+      const data = await fetchDeviceStatus();
+      if (turn !== renderTurn || gen !== sessionGen || session !== currentSession) return;
+      if (data?.approved === true && data.state === 'approved') {
+        deviceSection.hidden = true;
+        loadNotes(session, turn);
+        return;
+      }
+      showDeviceGate(data);
     }
 
     deviceRequest.addEventListener('click', async () => {
@@ -268,9 +289,10 @@
       if (gen !== sessionGen) return;
       // 버튼은 요청만 보냅니다. 승인 여부는 서버 응답(state)과 자료 요청 결과로만 판단합니다.
       showDeviceState(data);
-      if (data?.state === 'approved') loadNotes(currentSession, renderTurn);
+      if (data?.state === 'approved' && currentSession) openIfApproved(currentSession, renderTurn);
     });
-    deviceRecheck.addEventListener('click', () => { if (currentSession) loadNotes(currentSession, renderTurn); });
+    // ‘승인 다시 확인’도 같은 순서: 승인 상태 확인 → approved일 때만 메모 요청
+    deviceRecheck.addEventListener('click', () => { if (currentSession) openIfApproved(currentSession, renderTurn); });
 
     async function loadNotes(session, turn) {
       const requestTurn = ++loadTurn;
@@ -302,7 +324,8 @@
       const turn = ++renderTurn;
       form.hidden = Boolean(session);
       signedIn.hidden = !session;
-      editorSection.hidden = !session;
+      // 쓰기 화면은 서버가 기기 승인을 확인하고 자료를 준 뒤에만 엽니다.
+      editorSection.hidden = true;
       if (!session) deviceSection.hidden = true;
       const user = session ? session.userId : null;
       if (user !== currentUser) {
@@ -316,7 +339,7 @@
       currentSession = session ?? null;
       status.textContent = session ? '로그인된 상태입니다.' : (pendingNotice || '이메일과 비밀번호로 로그인하세요.');
       if (!session) pendingNotice = '';
-      if (session) loadNotes(session, turn);
+      if (session) openIfApproved(session, turn);
       else showMessage('로그인하면 가상 메모를 볼 수 있습니다.');
     }
 
@@ -410,7 +433,7 @@
     const offlineBanner = document.querySelector('#offline-banner');
     if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
       const syncOnline = () => { offlineBanner.hidden = navigator.onLine !== false; };
-      window.addEventListener('online', () => { syncOnline(); if (currentSession) loadNotes(currentSession, renderTurn); });
+      window.addEventListener('online', () => { syncOnline(); if (currentSession) openIfApproved(currentSession, renderTurn); });
       window.addEventListener('offline', syncOnline);
       syncOnline();
       if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
diff --git a/test/ui-security.test.mjs b/test/ui-security.test.mjs
index 0fc61bc..996cd77 100644
--- a/test/ui-security.test.mjs
+++ b/test/ui-security.test.mjs
@@ -24,6 +24,8 @@ async function page() {
   let serverUser = null;
   let nextLogin = null;
   let failLogin = false;
+  // 11단계: 화면은 먼저 /api/device/status를 묻습니다. 기본은 승인된 기기입니다.
+  let deviceState = { state: 'approved', approved: true, code: 'ABCD-1234' };
   const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
   const context = {
     document: { querySelector: get, createElement: tag => new Element(tag) },
@@ -36,6 +38,7 @@ async function page() {
         return json(200, { signedIn: true, userId: serverUser });
       }
       if (url === '/api/auth/logout') { serverUser = null; return json(200, { signedIn: false, revoked: true }); }
+      if (url === '/api/device/status') return json(200, deviceState);
       return new Promise(resolve => pending.push({ url, init, resolve }));
     },
     setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
@@ -51,7 +54,7 @@ async function page() {
   };
   const reply = async (request, notes = [], status = 200) => { request.resolve({ ok: status < 400, status, json: async () => notes }); await flush(); };
   const list = () => get('#notes');
-  return { get, pending, auth, reply, flush, list, failLogin: () => { failLogin = true; } };
+  return { get, pending, auth, reply, flush, list, failLogin: () => { failLogin = true; }, setDevice: state => { deviceState = state; } };
 }
 
 test('account switch immediately clears prior memo text and ignores the prior account response', async () => {
@@ -106,28 +109,35 @@ test('login network errors clear password and re-enable the button', async () =>
   assert.match(p.get('#auth-status').textContent, /로그인에 실패/u);
 });
 
-test('11단계: unapproved device shows the approval panel without notes; approved device opens the existing screen', async () => {
+test('11단계: device status is checked first; unapproved device gets no notes request and no data', async () => {
   const p = await page();
+  p.setDevice({ state: 'pending', approved: false, code: 'ABCD-1234' });
   await p.auth('A');
-  await p.reply(p.pending.at(-1), { error: 'DEVICE_NOT_APPROVED' }, 403);
+  // 승인 전에는 메모 요청 자체를 보내지 않습니다.
+  assert.equal(p.pending.filter(item => item.url.startsWith('/api/notes')).length, 0);
   assert.equal(p.get('#device-section').hidden, false);
   assert.equal(p.get('#editor-section').hidden, true);
   assert.equal(p.list().children[0].textContent, '이 기기는 아직 승인되지 않아 자료를 표시하지 않습니다.');
-  const status = p.pending.at(-1);
-  assert.equal(status.url, '/api/device/status');
-  await p.reply(status, { state: 'pending', approved: false, code: 'ABCD-1234' });
   assert.equal(p.get('#device-code').textContent, 'ABCD-1234');
-  // 승인 요청 버튼은 요청만 보내고, 응답이 pending이면 자료를 열지 않습니다.
+  // 승인 요청 버튼은 요청만 보내고, 응답이 pending이면 메모를 요청하지 않습니다.
   const click = p.get('#device-request').fire('click');
   const request = p.pending.at(-1);
   assert.equal(request.url, '/api/device/request');
   assert.equal(request.init.method, 'POST');
   await p.reply(request, { state: 'pending', approved: false, code: 'ABCD-1234' }); await click;
+  assert.equal(p.pending.filter(item => item.url.startsWith('/api/notes')).length, 0);
   assert.equal(p.get('#device-section').hidden, false);
-  assert.equal(p.list().children[0].textContent, '이 기기는 아직 승인되지 않아 자료를 표시하지 않습니다.');
-  // 서버가 승인한 뒤 다시 확인하면 기존 화면이 열립니다.
+  // 확인 실패(서버 응답 이상)도 승인 안 됨으로 취급합니다.
+  p.setDevice(null);
+  p.get('#device-recheck').fire('click'); await p.flush();
+  assert.equal(p.pending.filter(item => item.url.startsWith('/api/notes')).length, 0);
+  assert.equal(p.get('#editor-section').hidden, true);
+  // 서버가 승인한 뒤 ‘승인 다시 확인’ → 상태 확인 → 메모 요청 → 기존 화면
+  p.setDevice({ state: 'approved', approved: true, code: 'ABCD-1234' });
   p.get('#device-recheck').fire('click'); await p.flush();
-  await p.reply(p.pending.at(-1), [{ id: 'a', title: 'A note', body: '' }]);
+  const notes = p.pending.at(-1);
+  assert.equal(notes.url, '/api/notes');
+  await p.reply(notes, [{ id: 'a', title: 'A note', body: '' }]);
   assert.equal(p.get('#device-section').hidden, true);
   assert.equal(p.get('#editor-section').hidden, false);
   assert.equal(p.list().children[0].children[0].textContent, 'A note');
EOF11B
echo '적용 완료'
node --test --test-concurrency=1 test/*.test.mjs 2>&1 | tail -8