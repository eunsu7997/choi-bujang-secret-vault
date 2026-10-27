-- 4단계 제작 1: 원본 가상 메모 4건을 학생 A 소유로 확인·연결하고, 학생 B 소유의 공개 가능한 시험 메모 1건을 둡니다.
-- Supabase SQL Editor(postgres 역할)에서 실행합니다. 다시 실행해도 안전합니다(이미 맞으면 바뀌는 행 0건).
-- 사용법: 아래 두 이메일만 SQL Editor 안에서 바꿔 넣고 실행하세요. 이 파일에 실제 이메일을 저장·커밋하지 마세요.
-- 결과에는 건수만 나오며 이메일·UUID·메모 본문은 출력하지 않습니다.
-- backup.notes_before_ownership은 읽기만 하고 바꾸지 않습니다.

begin;

create temporary table step4_input on commit drop as
select 'A_EMAIL_HERE'::text as a_email,
       'B_EMAIL_HERE'::text as b_email,
       -- 원본 4건이 이미 A가 아닌 다른 계정 소유일 때만 true로 바꿉니다. 기본값은 바꾸지 않고 중단합니다.
       false as allow_reassign;

do $$
declare
  v_a uuid; v_b uuid; v_allow boolean;
  v_originals int; v_not_a int; v_judge int;
begin
  select a_email, b_email, allow_reassign into strict v_a, v_b, v_allow
    from (select (select id from auth.users where lower(email) = lower(i.a_email)) as a_email,
                 (select id from auth.users where lower(email) = lower(i.b_email)) as b_email,
                 i.allow_reassign from step4_input i) s;
  if v_a is null or v_b is null then
    raise exception 'A 또는 B 이메일에 해당하는 auth.users 계정이 없습니다. 두 이메일을 확인하세요.';
  end if;
  if v_a = v_b then raise exception 'A와 B가 같은 계정입니다.'; end if;
  if to_regclass('backup.notes_before_ownership') is null then
    raise exception '백업 사본이 없습니다. 원본 4건을 식별할 수 없어 중단합니다.';
  end if;

  lock table public.notes in share row exclusive mode;

  -- 원본 4건 = 백업에 있는 id. 본문·제목·생성시각이 백업과 같아야 합니다(소유자 외 변경 금지).
  select count(*) into v_originals from public.notes n join backup.notes_before_ownership k using (id)
   where n.title = k.title and n.content = k.content and n.created_at = k.created_at;
  if v_originals <> 4 or (select count(*) from backup.notes_before_ownership) <> 4 then
    raise exception '원본 메모 4건이 백업과 일치하지 않습니다(일치 %건). 데이터를 보존하고 중단합니다.', v_originals;
  end if;
  select count(*) into v_judge from public.notes n join backup.notes_before_ownership k using (id)
   where n.owner_kind <> 'student';
  if v_judge > 0 then raise exception '원본 메모 중 학생 소유가 아닌 행이 있습니다. 중단합니다.'; end if;

  select count(*) into v_not_a from public.notes n join backup.notes_before_ownership k using (id)
   where n.owner_id <> v_a;
  if v_not_a > 0 and not v_allow then
    raise exception '원본 % 건이 A가 아닌 계정 소유입니다. 재배정이 맞으면 allow_reassign을 true로 바꿔 다시 실행하세요.', v_not_a;
  end if;

  update public.notes n set owner_id = v_a
    from backup.notes_before_ownership k
   where n.id = k.id and n.owner_kind = 'student' and n.owner_id <> v_a;

  -- 공개 가능한 B 시험 메모. 고정 ID라서 두 번 실행해도 한 건만 남습니다.
  insert into public.notes (id, owner_kind, owner_id, title, content)
  values ('b4b4b4b4-0000-4000-8000-000000000001', 'student', v_b,
          'B 시험 메모 (공개 가능한 가상 자료)', '4단계 소유권 격리 확인용 가상 메모입니다.')
  on conflict (id) do nothing;
  if not exists (select 1 from public.notes where id = 'b4b4b4b4-0000-4000-8000-000000000001'
                 and owner_kind = 'student' and owner_id = v_b) then
    raise exception 'B 시험 메모 ID가 다른 소유자에게 있습니다. 중단합니다.';
  end if;
end $$;

-- 확인(건수만): 기대값 originals_owned_by_a=4, b_test_note=1, backup_rows=4
select
  (select count(*) from public.notes n join backup.notes_before_ownership k using (id), step4_input i
    where n.owner_kind = 'student'
      and n.owner_id = (select id from auth.users where lower(email) = lower(i.a_email))) as originals_owned_by_a,
  (select count(*) from public.notes, step4_input i
    where id = 'b4b4b4b4-0000-4000-8000-000000000001' and owner_kind = 'student'
      and owner_id = (select id from auth.users where lower(email) = lower(i.b_email))) as b_test_note,
  (select count(*) from backup.notes_before_ownership) as backup_rows,
  (select count(*) from public.notes) as total_rows;

commit;
