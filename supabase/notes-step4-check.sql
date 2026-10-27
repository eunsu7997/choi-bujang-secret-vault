-- 4단계 권한·격리 확인(읽기 전용). notes-step4-rls.sql 적용 전과 후에 각각 실행해 결과를 대조합니다.
-- 마지막 블록은 트랜잭션 안에서 역할만 바꿔 보고 rollback 하므로 데이터가 바뀌지 않습니다.
-- 결과에는 건수·참거짓만 나옵니다. 이메일 두 곳만 SQL Editor 안에서 바꿔 넣고, 파일에는 저장하지 마세요.

-- 1) 표 수준 권한 목록 (적용 후 기대: anon 없음, authenticated는 SELECT·INSERT·UPDATE·DELETE)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'notes' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
group by grantee order by grantee;

-- 2) 실제 유효 권한
select r as role, p as privilege, has_table_privilege(r, 'public.notes', p) as granted
from unnest(array['anon', 'authenticated']) r,
     unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
order by 1, 2;

-- 3) RLS 상태와 정책
select relrowsecurity as rls, relforcerowsecurity as force_rls from pg_class where oid = 'public.notes'::regclass;
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'notes' order by policyname;

-- 4) [적용 후에만] DB 직접 접근 모의 시험 (적용 전에는 권한이 없어 오류가 나는 것이 정상): A·B 신원으로 authenticated 역할을 흉내 내 보이는 행 수와 차단 여부를 셉니다.
--    (적용 후 기대: a_inserts_own=allowed, a_updates_own=1, a_deletes_own=1, a_sees_own=4, a_sees_b=0, b_sees_own=1, b_sees_a=0, anon_sees=0 또는 권한 오류, judge_visible=0)
begin;
create temporary table step4_who on commit drop as
select (select id from auth.users where lower(email) = lower('A_EMAIL_HERE')) as a,
       (select id from auth.users where lower(email) = lower('B_EMAIL_HERE')) as b;
grant select on step4_who to authenticated, anon;
create temporary table step4_result (check_name text, value text) on commit drop;
grant insert on step4_result to authenticated, anon;

do $$
declare v_a uuid; v_b uuid; n int; moved int;
begin
  select a, b into v_a, v_b from step4_who;
  if v_a is null or v_b is null then raise exception 'A 또는 B 계정을 찾지 못했습니다.'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notes where owner_id = v_a; insert into step4_result values ('a_sees_own', n);
  select count(*) into n from public.notes where owner_id = v_b; insert into step4_result values ('a_sees_b', n);
  select count(*) into n from public.notes where owner_kind = 'judge'; insert into step4_result values ('judge_visible_to_a', n);
  update public.notes set title = title where owner_id = v_b; get diagnostics moved = row_count;
  insert into step4_result values ('a_updates_b_rows', moved);
  delete from public.notes where owner_id = v_b; get diagnostics moved = row_count;
  insert into step4_result values ('a_deletes_b_rows', moved);
  begin
    insert into public.notes (owner_kind, owner_id, title, content) values ('student', v_b, 'x', '');
    insert into step4_result values ('a_inserts_as_b', 'allowed');
  exception when insufficient_privilege then insert into step4_result values ('a_inserts_as_b', 'denied'); end;
  -- 본인 행 추가·수정·삭제는 허용되어야 합니다(마지막 rollback으로 모두 취소).
  begin
    insert into public.notes (id, owner_kind, owner_id, title, content)
      values ('a4a4a4a4-0000-4000-8000-0000000000ff', 'student', v_a, 'check', '');
    insert into step4_result values ('a_inserts_own', 'allowed');
  exception when insufficient_privilege then insert into step4_result values ('a_inserts_own', 'denied'); end;
  update public.notes set title = 'check2' where id = 'a4a4a4a4-0000-4000-8000-0000000000ff'; get diagnostics moved = row_count;
  insert into step4_result values ('a_updates_own', moved);
  delete from public.notes where id = 'a4a4a4a4-0000-4000-8000-0000000000ff'; get diagnostics moved = row_count;
  insert into step4_result values ('a_deletes_own', moved);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.notes where owner_id = v_b; insert into step4_result values ('b_sees_own', n);
  select count(*) into n from public.notes where owner_id = v_a; insert into step4_result values ('b_sees_a', n);
  update public.notes set owner_id = v_b where owner_id = v_a; get diagnostics moved = row_count;
  insert into step4_result values ('b_takes_a_rows', moved);
  begin
    update public.notes set owner_id = v_a where owner_id = v_b; get diagnostics moved = row_count;
    insert into step4_result values ('b_gives_own_row_to_a', moved);
  exception when insufficient_privilege then insert into step4_result values ('b_gives_own_row_to_a', 'denied'); end;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin
    select count(*) into n from public.notes; insert into step4_result values ('anon_sees', n);
  exception when insufficient_privilege then insert into step4_result values ('anon_sees', 'denied'); end;
  reset role;
end $$;

select * from step4_result;
rollback;
