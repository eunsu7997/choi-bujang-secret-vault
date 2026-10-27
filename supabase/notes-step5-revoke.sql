-- 5단계 제작 2: 브라우저 공개 키·로그인 토큰으로 public.notes를 직접 부르는 길을 닫습니다.
-- Supabase SQL Editor(postgres 역할)에서 실행합니다. 다시 실행해도 안전합니다. 다른 테이블은 건드리지 않습니다.
-- 메모 데이터, 백업, service_role(서버 함수) 권한, RLS·FORCE RLS는 그대로 둡니다.
-- 4단계 정책 4개는 남겨 둡니다. 권한이 없으면 정책만으로는 접근할 수 없고, 실수로 권한이 다시 열려도 본인 행으로 제한됩니다.
-- 적용 전후로 supabase/notes-step5-check.sql을 실행해 대조하세요.
-- 되돌리기(4단계 상태): supabase/notes-step4-rls.sql 재실행

begin;

do $$
begin
  if to_regclass('public.notes') is null then raise exception 'public.notes가 없습니다.'; end if;
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls)) then
    raise exception 'postgres 역할로 실행하세요(현재 %).', current_user;
  end if;
end $$;

alter table public.notes enable row level security;
alter table public.notes force row level security;

revoke all on table public.notes from public, anon, authenticated;
-- 서버 함수는 service_role 키로만 메모를 다룹니다.
grant select, insert, update, delete on table public.notes to service_role;

do $$
declare r text; p text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.notes', p) then
        raise exception '% 역할에 % 권한이 남아 있습니다.', r, p;
      end if;
    end loop;
  end loop;
  if not (has_table_privilege('service_role', 'public.notes', 'SELECT') and has_table_privilege('service_role', 'public.notes', 'INSERT')
     and has_table_privilege('service_role', 'public.notes', 'UPDATE') and has_table_privilege('service_role', 'public.notes', 'DELETE')) then
    raise exception 'service_role 권한이 없어 서버 함수가 동작하지 않습니다.';
  end if;
end $$;

commit;
