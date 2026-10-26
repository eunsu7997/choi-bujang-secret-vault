-- notes-ownership.sql을 적용하기 직전에 한 번 실행하는 수동 백업입니다. 원본 행은 바꾸지 않습니다.
-- API로 공개되지 않는 backup 스키마에 사본을 두고, 사본에도 RLS를 켜고 공개 권한을 회수합니다.
-- 같은 날 다시 실행하면 이미 있는 사본을 덮어쓰지 않고 중단합니다.

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

do $$
begin
  -- notes는 FORCE RLS·정책 0개라, RLS를 우회하지 못하는 역할에는 행이 하나도 보이지 않습니다.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception '현재 역할(%)이 RLS를 우회하지 못해 메모가 보이지 않습니다. SQL Editor의 postgres 역할로 실행하세요.', current_user;
  end if;
  if to_regclass('backup.notes_before_ownership') is not null then
    raise exception '이미 backup.notes_before_ownership 사본이 있습니다. 덮어쓰지 않습니다.';
  end if;
end $$;

-- 백업과 대조가 같은 원본을 보도록 트랜잭션 동안 쓰기를 막습니다.
lock table public.notes in share mode;
create table backup.notes_before_ownership as table public.notes;

-- 메모가 있는데 사본이 비었다면(예상치 못한 RLS 적용 등) 전체를 취소합니다.
do $$
begin
  if (select count(*) from backup.notes_before_ownership) <> (select count(*) from public.notes)
     or (select count(*) from backup.notes_before_ownership) = 0 then
    raise exception '백업 행 수가 원본과 다르거나 0건입니다. 아무것도 남기지 않고 취소합니다.';
  end if;
end $$;
alter table backup.notes_before_ownership enable row level security;
alter table backup.notes_before_ownership force row level security;
revoke all on table backup.notes_before_ownership from public, anon, authenticated;

commit;

-- 확인(읽기 전용): 원본과 사본의 행 수가 같아야 합니다.
select (select count(*) from public.notes) as original, (select count(*) from backup.notes_before_ownership) as backup;

-- 복원은 마지막 수단입니다(되돌리기 SQL 실행 뒤, PM 판단으로만).
-- 백업 이후의 정상 추가·수정도 사라지므로, 먼저 현재 상태를 따로 보존하고 차이를 확인합니다.
--   create table backup.notes_before_restore as table public.notes;   -- 현재 상태 보존
--   alter table backup.notes_before_restore enable row level security;
--   select count(*) from public.notes n where not exists
--     (select 1 from backup.notes_before_ownership b where b.id = n.id);  -- 백업 뒤 새로 생긴 메모 수
--   select count(*) from backup.notes_before_ownership b where not exists
--     (select 1 from public.notes n where n.id = b.id);                   -- 사라진 메모 수
--   select count(*) from public.notes n join backup.notes_before_ownership b using (id)
--     where (n.owner_id, n.title, n.content) is distinct from (b.owner_id, b.title, b.content);  -- 백업 뒤 바뀐 메모 수
-- 위 차이를 확인하고 잃어도 되는지 판단한 뒤에만:
--   begin;
--   delete from public.notes;
--   insert into public.notes (id, owner_id, title, content, created_at)
--     select id, owner_id, title, content, created_at from backup.notes_before_ownership;
--   commit;
