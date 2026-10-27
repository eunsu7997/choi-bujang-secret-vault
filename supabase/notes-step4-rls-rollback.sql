-- 4단계 제작 3 되돌리기: 3단계 상태(RLS·FORCE RLS 유지, 정책 0개, anon·authenticated 권한 없음)로 돌아갑니다.
-- 메모 데이터와 백업, service_role(서버) 권한은 건드리지 않습니다. 서버 API는 계속 동작합니다.

begin;
drop policy if exists notes_select_own on public.notes;
drop policy if exists notes_insert_own on public.notes;
drop policy if exists notes_update_own on public.notes;
drop policy if exists notes_delete_own on public.notes;
revoke all on table public.notes from public, anon, authenticated;
alter table public.notes enable row level security;
alter table public.notes force row level security;
commit;
