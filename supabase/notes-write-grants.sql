-- 3단계: 서버 함수(service_role)가 메모를 추가·수정·삭제할 수 있게 권한을 더합니다.
-- supabase/notes.sql을 실행한 뒤 Supabase 대시보드 > SQL Editor에서 한 번 실행합니다.
-- 키나 비밀번호는 필요하지 않습니다. 여러 번 실행해도 됩니다.

begin;

-- service_role에만 쓰기 권한을 더합니다. anon·authenticated에는 여전히 아무 권한도 없고,
-- RLS는 켜진 채 정책이 없으므로 브라우저 키로는 어떤 행도 읽거나 쓸 수 없습니다.
grant select, insert, update, delete on table public.vault_notes to service_role;
revoke all on table public.vault_notes from public, anon, authenticated;

commit;

-- 확인: service_role에 SELECT·INSERT·UPDATE·DELETE, anon·authenticated는 0줄이어야 합니다.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vault_notes'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- (선택) 처음 넣은 가상 메모는 owner_id가 비어 있어 목록 GET에 나오지 않습니다.
-- A 계정 목록에 보이게 하려면 Authentication > Users에서 A의 User UID를 복사해
-- 아래 자리표시자를 바꾼 뒤 이 한 줄만 따로 실행합니다. 이메일은 적지 않습니다.
-- update public.vault_notes set owner_id = '<A 계정 User UID>' where owner_id is null;
