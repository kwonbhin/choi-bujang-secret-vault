-- 2단계: 가상 메모를 담을 학습용 Supabase 테이블을 만듭니다.
-- Supabase 대시보드 > SQL Editor에서 한 번 실행합니다. 키나 비밀번호는 필요하지 않습니다.
-- 여러 번 실행해도 됩니다.
-- 실제 학생 자료를 넣지 마세요.

begin;

create table if not exists public.vault_notes (
  id uuid primary key default gen_random_uuid(),
  -- 3단계 이후 로그인 사용자와 연결할 자리입니다. auth.users 외래키는 걸지 않습니다.
  owner_id uuid,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- RLS를 켜고 정책은 만들지 않습니다. anon·authenticated는 어떤 행도 읽을 수 없습니다.
alter table public.vault_notes enable row level security;

-- Supabase가 새 테이블에 기본으로 주는 권한을 모두 거두고 service_role에만 select를 줍니다.
revoke all on table public.vault_notes from public, anon, authenticated, service_role;
grant select on table public.vault_notes to service_role;

-- 메모 입력은 저장소에 두지 않습니다. 로컬 파일 supabase/seed.local.sql로 넣습니다.

commit;
