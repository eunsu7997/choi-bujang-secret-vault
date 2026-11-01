-- 11단계: 기기 승인 기록 테이블. Supabase SQL Editor(postgres 역할)에서 한 번 실행합니다. 다시 실행해도 안전합니다.
-- 기기 식별값의 원래 값은 저장하지 않고 SHA-256 해시만 둡니다. 서버(service_role)는 읽기와 "대기" 행 추가만 할 수 있고,
-- 승인(approved)으로 바꾸는 일은 계정 주인이 SQL Editor에서 device-approve.sql로만 합니다. 다른 테이블은 건드리지 않습니다.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception '현재 역할(%)이 RLS를 우회하지 못합니다. SQL Editor의 postgres 역할로 실행하세요.', current_user;
  end if;
end $$;

create table if not exists public.device_approvals (
  owner_kind text not null check (owner_kind in ('student', 'judge')),
  user_id uuid not null,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  primary key (owner_kind, user_id, device_hash)
);

alter table public.device_approvals enable row level security;
alter table public.device_approvals force row level security;
revoke all on table public.device_approvals from public, anon, authenticated, service_role;
grant select, insert on table public.device_approvals to service_role;

-- 서버가 넣는 행은 언제나 "대기"입니다. 승인 상태로 바로 넣을 수 없습니다.
create or replace function public.device_approvals_insert_pending() returns trigger
language plpgsql as $$
begin
  if new.status <> 'pending' or new.approved_at is not null then
    raise exception 'device_approvals rows start as pending';
  end if;
  return new;
end $$;
drop trigger if exists device_approvals_pending_only on public.device_approvals;
create trigger device_approvals_pending_only before insert on public.device_approvals
  for each row execute function public.device_approvals_insert_pending();

commit;

-- 확인(읽기 전용)
select
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.device_approvals'::regclass) as rls_forced,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'device_approvals'
     and grantee in ('anon', 'authenticated', 'PUBLIC')) as public_grants,
  (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'device_approvals' and grantee = 'service_role') as server_grants,
  (select count(*) from public.device_approvals) as devices;
