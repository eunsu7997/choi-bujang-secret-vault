-- 2단계: 가상 메모를 담을 notes 테이블
-- Supabase SQL Editor에서 한 번 실행합니다. 다시 실행해도 안전합니다.
-- owner_id는 로그인 사용자 UUID를 담지만 auth.users 외래키는 두지 않습니다.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  content text not null default '' check (char_length(content) <= 10000),
  created_at timestamptz not null default now()
);

create index if not exists notes_owner_id_idx on public.notes (owner_id);

-- RLS를 켜고 정책은 만들지 않습니다. 정책이 없으면 anon·authenticated는 행을 볼 수 없습니다.
alter table public.notes enable row level security;
alter table public.notes force row level security;

-- Supabase 기본 권한으로 열린 직접 접근(REST /rest/v1/notes)도 닫습니다.
revoke all on table public.notes from public, anon, authenticated;
