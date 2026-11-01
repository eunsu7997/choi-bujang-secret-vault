-- 10단계 확인(읽기 전용). 바꾸는 문장이 없습니다.
select
  (select count(*) from public.notes_restore_point) as restore_points,
  (select content_sha256 from public.notes_restore_point where id = 'b4b4b4b4-0000-4000-8000-000000000001') as point_sha256,
  (select encode(sha256(convert_to(title || E'\n' || content, 'UTF8')), 'hex') from public.notes
    where id = 'b4b4b4b4-0000-4000-8000-000000000001') as current_sha256,
  (select (n.owner_kind, n.owner_id) = (p.owner_kind, p.owner_id) from public.notes n
    join public.notes_restore_point p using (id) where n.id = 'b4b4b4b4-0000-4000-8000-000000000001') as owner_match,
  (select count(*) from public.notes) as notes_total,
  (select count(*) from public.notes_restore_audit) as audit_rows,
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notes_restore_point'::regclass) as point_rls,
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notes_restore_audit'::regclass) as audit_rls,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('notes_restore_point', 'notes_restore_audit')
      and grantee in ('anon', 'authenticated', 'PUBLIC')) as public_grants;
