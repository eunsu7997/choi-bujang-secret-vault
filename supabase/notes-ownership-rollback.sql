-- notes-ownership.sql 되돌리기. 2단계 코드(af1740b)로 되돌린 뒤에만 실행합니다.
-- 메모 행은 지우지 않습니다. 심판 소유 메모가 있으면 학생 메모와 구분할 수 없게 되므로 중단합니다.

begin;

do $$
begin
  -- FORCE RLS 아래에서 숨겨진 심판 행을 없는 것으로 오인하지 않도록 먼저 검사합니다.
  if not exists (select 1 from pg_catalog.pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception '현재 역할은 RLS를 우회할 수 없어 안전한 롤백을 확인할 수 없습니다.'
      using errcode = '42501';
  end if;
  -- 검사와 컬럼 제거 사이의 동시 쓰기를 막습니다. 트랜잭션 종료까지 유지됩니다.
  lock table public.notes in access exclusive mode;
  if exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notes' and column_name = 'owner_kind')
     and exists (select 1 from public.notes where owner_kind is distinct from 'student') then
    raise exception '심판(judge) 소유 메모가 있어 되돌리지 않습니다. 소유권을 보존한 채 롤백을 중단합니다.';
  end if;
end $$;

drop index if exists public.notes_owner_idx;
alter table public.notes drop constraint if exists notes_owner_kind_check;
alter table public.notes drop column if exists owner_kind;
create index if not exists notes_owner_id_idx on public.notes (owner_id);

-- 2단계 상태: 서버 전용 키는 읽기만 합니다. RLS와 anon·authenticated 차단은 유지합니다.
revoke insert, update, delete on table public.notes from service_role;
revoke truncate, references, trigger on table public.notes from service_role;
grant select on table public.notes to service_role;
alter table public.notes enable row level security;
alter table public.notes force row level security;
revoke all on table public.notes from public, anon, authenticated;

commit;
