-- 10단계 제작 3: 시험 계정 B의 가상 메모 한 건(b4b4b4b4-0000-4000-8000-000000000001)의 비공개 사본과 한 건 복원 함수.
-- Supabase SQL Editor(postgres 역할)에서 한 번 실행합니다. 다른 메모는 읽기만 하고 바꾸지 않습니다.
-- 사본·감사 기록 테이블은 RLS·FORCE RLS를 켜고 anon·authenticated 권한을 주지 않습니다(서버 service_role만).
-- 다시 실행해도 기존 사본을 덮어쓰지 않습니다. B 메모가 이미 바뀌어 있으면 사본을 만들지 않고 중단합니다.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception '현재 역할(%)이 RLS를 우회하지 못합니다. SQL Editor의 postgres 역할로 실행하세요.', current_user;
  end if;
end $$;

create table if not exists public.notes_restore_point (
  id uuid primary key,
  owner_kind text not null check (owner_kind in ('student', 'judge')),
  owner_id uuid not null,
  title text not null,
  content text not null,
  created_at timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default now()
);

create table if not exists public.notes_restore_audit (
  seq bigint generated always as identity primary key,
  at timestamptz not null default now(),
  note_id uuid not null,
  actor_kind text not null,
  action text not null,
  content_sha256 text
);

alter table public.notes_restore_point enable row level security;
alter table public.notes_restore_point force row level security;
alter table public.notes_restore_audit enable row level security;
alter table public.notes_restore_audit force row level security;
revoke all on table public.notes_restore_point from public, anon, authenticated;
revoke all on table public.notes_restore_audit from public, anon, authenticated;
grant select on table public.notes_restore_point to service_role;
grant select, insert on table public.notes_restore_audit to service_role;

-- 감사 기록은 추가만 됩니다(수정·삭제·비우기 금지).
create or replace function public.notes_restore_audit_append_only() returns trigger
language plpgsql as $$ begin raise exception 'notes_restore_audit is append-only'; end $$;
drop trigger if exists notes_restore_audit_no_change on public.notes_restore_audit;
create trigger notes_restore_audit_no_change before update or delete on public.notes_restore_audit
  for each row execute function public.notes_restore_audit_append_only();
drop trigger if exists notes_restore_audit_no_truncate on public.notes_restore_audit;
create trigger notes_restore_audit_no_truncate before truncate on public.notes_restore_audit
  for each statement execute function public.notes_restore_audit_append_only();

-- 침해 전 상태 확인 뒤 사본을 만듭니다. 내용 해시는 sha256(title || 줄바꿈 || content)입니다.
do $$
declare n record;
begin
  select * into n from public.notes where id = 'b4b4b4b4-0000-4000-8000-000000000001';
  if not found then
    raise exception 'B 시험 메모가 없습니다. 4단계 notes-step4-owners.sql 상태를 먼저 확인하세요.';
  end if;
  if n.owner_kind <> 'student' or n.title <> 'B 시험 메모 (공개 가능한 가상 자료)'
     or n.content <> '4단계 소유권 격리 확인용 가상 메모입니다.' then
    raise exception 'B 시험 메모가 이미 바뀌어 있습니다. 검증된 상태가 아니므로 사본을 만들지 않습니다.';
  end if;
  if exists (select 1 from public.notes_restore_point where id = n.id) then
    if not exists (select 1 from public.notes_restore_point where id = n.id and owner_kind = n.owner_kind
                   and owner_id = n.owner_id and title = n.title and content = n.content) then
      raise exception '기존 사본과 현재 B 메모가 다릅니다. 사본을 덮어쓰지 않습니다.';
    end if;
  else
    insert into public.notes_restore_point (id, owner_kind, owner_id, title, content, created_at, content_sha256)
    values (n.id, n.owner_kind, n.owner_id, n.title, n.content, n.created_at,
            encode(sha256(convert_to(n.title || E'\n' || n.content, 'UTF8')), 'hex'));
  end if;
end $$;

-- 한 건 복원: 사본 해시를 다시 확인하고, 소유자가 같을 때만 그 한 건을 되돌린 뒤 결과를 다시 대조합니다.
-- 호출자는 서버가 검증한 토큰의 (종류, 사용자 번호)입니다. 사본 주인(학생 B)이나 심판만 허용합니다.
create or replace function public.restore_note_from_point(p_note_id uuid, p_actor_kind text, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  n record;
  act text;
begin
  select * into p from public.notes_restore_point where id = p_note_id;
  if not found then return jsonb_build_object('status', 'missing'); end if;
  if encode(sha256(convert_to(p.title || E'\n' || p.content, 'UTF8')), 'hex') <> p.content_sha256 then
    raise exception 'restore_point_hash_mismatch';
  end if;
  if not (p_actor_kind = 'judge' or (p_actor_kind = 'student' and p_actor_id = p.owner_id)) then
    insert into public.notes_restore_audit (note_id, actor_kind, action) values (p.id, coalesce(p_actor_kind, 'unknown'), 'denied');
    return jsonb_build_object('status', 'forbidden');
  end if;
  select * into n from public.notes where id = p.id for update;
  if found then
    if n.owner_kind <> p.owner_kind or n.owner_id <> p.owner_id then
      insert into public.notes_restore_audit (note_id, actor_kind, action) values (p.id, p_actor_kind, 'owner_mismatch');
      return jsonb_build_object('status', 'conflict');
    end if;
    if n.title = p.title and n.content = p.content then
      act := 'unchanged';
    else
      update public.notes set title = p.title, content = p.content where id = p.id;
      act := 'updated';
    end if;
  else
    insert into public.notes (id, owner_kind, owner_id, title, content, created_at)
    values (p.id, p.owner_kind, p.owner_id, p.title, p.content, p.created_at);
    act := 'reinserted';
  end if;
  select * into n from public.notes where id = p.id;
  if n.owner_kind <> p.owner_kind or n.owner_id <> p.owner_id
     or encode(sha256(convert_to(n.title || E'\n' || n.content, 'UTF8')), 'hex') <> p.content_sha256 then
    raise exception 'restore_verify_failed';
  end if;
  insert into public.notes_restore_audit (note_id, actor_kind, action, content_sha256)
  values (p.id, p_actor_kind, act, p.content_sha256);
  return jsonb_build_object('status', 'restored', 'action', act, 'id', p.id, 'owner_kind', p.owner_kind,
    'owner_match', true, 'content_sha256', p.content_sha256);
end $$;
revoke all on function public.restore_note_from_point(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.restore_note_from_point(uuid, text, uuid) to service_role;

commit;

-- 확인(읽기 전용): notes-step10-check.sql을 실행하세요.
