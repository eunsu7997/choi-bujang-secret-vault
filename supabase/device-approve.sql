-- 11단계: 기기 승인(계정 주인이 직접). 화면의 "승인 코드"와 내 계정 이메일을 확인한 뒤 아래 두 값을 바꿔 실행합니다.
-- 이메일·코드는 이 파일에 저장하거나 커밋하지 말고 SQL Editor에서만 바꿉니다. 대기(pending) 중인 그 기기 한 대만 승인합니다.
with target as (
  select d.owner_kind, d.user_id, d.device_hash
  from public.device_approvals d
  join auth.users u on u.id = d.user_id
  where d.owner_kind = 'student'
    and lower(u.email) = lower('내-계정-이메일@example.com')              -- ← 바꾸기
    and upper(left(d.device_hash, 8)) = upper(replace('ABCD-1234', '-', ''))  -- ← 화면의 승인 코드로 바꾸기
    and d.status = 'pending'
)
update public.device_approvals d
set status = 'approved', approved_at = now()
from target t
where (d.owner_kind, d.user_id, d.device_hash) = (t.owner_kind, t.user_id, t.device_hash)
  and (select count(*) from target) = 1
returning upper(left(d.device_hash, 4) || '-' || substr(d.device_hash, 5, 4)) as approved_code, d.status, d.approved_at;

-- 승인 취소(분실·의심 기기): 위와 같은 조건으로 status = 'revoked' 로 바꿉니다.
