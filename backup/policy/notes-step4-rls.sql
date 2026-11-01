-- 4단계 제작 3: public.notes 한 테이블에만 최소 권한과 본인 행 RLS 정책을 적용합니다.
-- Supabase SQL Editor(postgres 역할)에서 실행합니다. 다시 실행해도 안전합니다. 다른 테이블은 건드리지 않습니다.
-- 적용 전후로 supabase/notes-step4-check.sql을 실행해 권한을 대조하세요.
-- 되돌리기: supabase/notes-step4-rls-rollback.sql (3단계 상태: 정책 0개, anon·authenticated 권한 없음)
--
-- 서버 API와의 관계:
--   서버 /api/notes는 서버 전용 키(service_role, BYPASSRLS)로 접속하므로 이 정책의 영향을 받지 않습니다.
--   서버의 격리는 api/notes.js의 (owner_kind, owner_id) 필터가 계속 담당합니다(이중 방어).
--   이 정책은 브라우저의 공개 키로 Supabase Data API(/rest/v1/notes)에 직접 접근하는 경로를 막습니다.
--   anon: 권한 없음 → 거부. authenticated(학생 Supabase JWT): 본인 학생 행만.
--   심판 메모(owner_kind='judge')는 Supabase JWT로 직접 접근할 수 없도록 owner_kind='student'를 함께 요구합니다.

begin;

do $$
begin
  if to_regclass('public.notes') is null then raise exception 'public.notes가 없습니다.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'notes' and column_name = 'owner_kind') then
    raise exception 'owner_kind 컬럼이 없습니다. 3단계 notes-ownership.sql 상태를 확인하세요.';
  end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'postgres 역할로 실행하세요(현재 %).', current_user;
  end if;
end $$;

alter table public.notes enable row level security;
alter table public.notes force row level security;

-- 1) 기존 권한 회수 → 2) authenticated에 네 가지 권한만 부여. service_role(서버) 권한은 유지합니다.
revoke all on table public.notes from public, anon, authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;

-- SELECT: 기존 행 USING
create policy notes_select_own on public.notes for select to authenticated
  using (auth.uid() = owner_id and owner_kind = 'student');
-- INSERT: 새 행 WITH CHECK
create policy notes_insert_own on public.notes for insert to authenticated
  with check (auth.uid() = owner_id and owner_kind = 'student');
-- UPDATE: 기존 행 USING + 새 행 WITH CHECK (소유자를 남에게 넘기거나 심판 행으로 바꿀 수 없음)
create policy notes_update_own on public.notes for update to authenticated
  using (auth.uid() = owner_id and owner_kind = 'student')
  with check (auth.uid() = owner_id and owner_kind = 'student');
-- DELETE: 기존 행 USING
create policy notes_delete_own on public.notes for delete to authenticated
  using (auth.uid() = owner_id and owner_kind = 'student');

-- 사후 조건: 기대와 다르면 전체를 취소합니다.
do $$
begin
  if has_table_privilege('anon', 'public.notes', 'SELECT') or has_table_privilege('anon', 'public.notes', 'INSERT')
     or has_table_privilege('anon', 'public.notes', 'UPDATE') or has_table_privilege('anon', 'public.notes', 'DELETE') then
    raise exception 'anon에 권한이 남아 있습니다.';
  end if;
  if not (has_table_privilege('authenticated', 'public.notes', 'SELECT') and has_table_privilege('authenticated', 'public.notes', 'INSERT')
     and has_table_privilege('authenticated', 'public.notes', 'UPDATE') and has_table_privilege('authenticated', 'public.notes', 'DELETE')) then
    raise exception 'authenticated에 네 가지 권한이 없습니다.';
  end if;
  if has_table_privilege('authenticated', 'public.notes', 'TRUNCATE') or has_table_privilege('authenticated', 'public.notes', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.notes', 'TRIGGER') then
    raise exception 'authenticated에 불필요한 권한이 남아 있습니다.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notes') <> 4 then
    raise exception 'notes 정책이 정확히 4개가 아닙니다.';
  end if;
end $$;

commit;
