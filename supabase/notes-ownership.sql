-- 3단계 제작 4: 소유자 종류(owner_kind)와 서버 쓰기 권한
-- notes.sql 다음에 Supabase SQL Editor에서 한 번 실행합니다. 다시 실행해도 안전합니다.
-- 기존 메모는 지우지 않고 학생 소유(owner_kind = 'student')로 남습니다.
-- 한 트랜잭션으로 실행해, 중간에 실패하면 아무것도 바뀌지 않습니다.

begin;

-- 사전 점검: 2단계 notes.sql 스키마가 아니면 중단합니다.
do $$
begin
  if to_regclass('public.notes') is null then
    raise exception 'public.notes 테이블이 없습니다. notes.sql을 먼저 실행하세요.';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notes' and column_name = 'owner_id' and data_type = 'uuid') then
    raise exception 'notes.owner_id(uuid) 컬럼이 없습니다. 스키마를 확인하세요.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.notes'::regclass) then
    raise exception 'notes의 RLS가 꺼져 있습니다. notes.sql을 다시 확인하세요.';
  end if;
  -- notes는 FORCE RLS·정책 0개라, RLS를 우회하지 못하는 역할에는 행이 하나도 보이지 않습니다.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception '현재 역할(%)이 RLS를 우회하지 못해 메모가 보이지 않습니다. SQL Editor의 postgres 역할로 실행하세요.', current_user;
  end if;
  if to_regclass('backup.notes_before_ownership') is null then
    raise exception '백업 사본(backup.notes_before_ownership)이 없습니다. notes-backup.sql을 먼저 실행하세요.';
  end if;
  -- 오래된 백업을 근거로 진행하지 않으며, 검사와 변경 사이의 쓰기도 차단합니다.
  lock table public.notes in access exclusive mode;
  if exists (
    (select id, owner_id, title, content, created_at from public.notes
     except all select id, owner_id, title, content, created_at from backup.notes_before_ownership)
    union all
    (select id, owner_id, title, content, created_at from backup.notes_before_ownership
     except all select id, owner_id, title, content, created_at from public.notes)
  ) then
    raise exception '현재 메모와 백업이 다릅니다. 데이터와 소유권을 보존하고 중단합니다.';
  end if;
  if exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notes' and column_name = 'owner_kind' and data_type <> 'text') then
    raise exception 'notes.owner_kind가 text가 아닙니다. 스키마를 확인하세요.';
  end if;
end $$;

alter table public.notes add column if not exists owner_kind text not null default 'student';
-- 이미 컬럼이 있던 경우에도 같은 규칙을 강제합니다. 값이 없는 기존 메모는 학생 소유로 봅니다.
update public.notes set owner_kind = 'student' where owner_kind is null;
alter table public.notes alter column owner_kind set default 'student';
alter table public.notes alter column owner_kind set not null;

alter table public.notes drop constraint if exists notes_owner_kind_check;
alter table public.notes add constraint notes_owner_kind_check check (owner_kind in ('student', 'judge'));

-- 서버는 언제나 (owner_kind, owner_id)로 거르므로 이 순서의 색인을 둡니다.
drop index if exists public.notes_owner_id_idx;
create index if not exists notes_owner_idx on public.notes (owner_kind, owner_id, created_at);

-- 서버 전용 키(service_role)만 읽고 쓸 수 있습니다. RLS 정책은 여전히 만들지 않습니다.
alter table public.notes enable row level security;
alter table public.notes force row level security;
revoke truncate, references, trigger on table public.notes from service_role;
grant select, insert, update, delete on table public.notes to service_role;
revoke all on table public.notes from public, anon, authenticated;

commit;

-- 적용 확인(읽기 전용): 소유자 종류별 건수와 정책 수만 봅니다.
select owner_kind, count(*) as notes from public.notes group by owner_kind order by owner_kind;
select count(*) as policies from pg_policies where schemaname = 'public' and tablename = 'notes';
