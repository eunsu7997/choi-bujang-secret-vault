-- 5단계 권한 확인(읽기 전용). notes-step5-revoke.sql 적용 전과 후에 실행해 결과를 대조합니다.
-- 적용 후 기대: grants에 anon·authenticated·PUBLIC 없음, anon_any=false, authenticated_any=false, service_role_crud=true, rls=true, force_rls=true
select json_build_object(
  'grants', (select json_agg(grantee || ':' || privilege_type order by grantee, privilege_type)
             from information_schema.role_table_grants
             where table_schema = 'public' and table_name = 'notes'),
  'anon_any', has_table_privilege('anon', 'public.notes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'authenticated_any', has_table_privilege('authenticated', 'public.notes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'service_role_crud', has_table_privilege('service_role', 'public.notes', 'SELECT') and has_table_privilege('service_role', 'public.notes', 'INSERT')
                       and has_table_privilege('service_role', 'public.notes', 'UPDATE') and has_table_privilege('service_role', 'public.notes', 'DELETE'),
  'rls', (select relrowsecurity from pg_class where oid = 'public.notes'::regclass),
  'force_rls', (select relforcerowsecurity from pg_class where oid = 'public.notes'::regclass),
  'policies', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'notes'),
  'total_rows', (select count(*) from public.notes)
) as step5_state;
