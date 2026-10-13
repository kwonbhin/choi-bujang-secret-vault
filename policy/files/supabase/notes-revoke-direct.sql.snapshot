-- 5단계: 메모 자료 요청을 서버 함수(/api/notes) 한곳으로 모읍니다.
-- vault_notes 한 테이블에서 PUBLIC·anon·authenticated의 직접 권한을 모두 거둡니다.
-- 그러면 브라우저가 publishable key나 로그인 토큰으로 Data API를 불러도 이 테이블에 닿지 못하고,
-- 서버 함수(service_role)만 읽고 씁니다. 다른 테이블은 건드리지 않습니다.
-- service_role 권한, RLS 켜짐, 4단계 정책 4개는 그대로 둡니다.
-- Supabase 대시보드 > SQL Editor에서 notes-rls.sql 다음에 실행합니다. 키나 비밀번호는 필요하지 않습니다.
-- 순서: [1] 적용 전 대조 → [2] 적용(한 트랜잭션) → [3] 적용 후 대조. 다시 실행해도 됩니다.
-- SQL Editor는 마지막 결과만 보여 주므로 구역을 하나씩 선택해 실행하세요.

-- ===================== [1] 적용 전 대조 =====================

-- 1-1. 명시적으로 받은 테이블 권한 (grantee별)
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vault_notes'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by grantee
order by grantee;

-- 1-2. 실제로 쓸 수 있는 권한 (PUBLIC으로 물려받은 권한까지 포함)
select role,
  has_table_privilege(role, 'public.vault_notes', 'SELECT')     as "select",
  has_table_privilege(role, 'public.vault_notes', 'INSERT')     as "insert",
  has_table_privilege(role, 'public.vault_notes', 'UPDATE')     as "update",
  has_table_privilege(role, 'public.vault_notes', 'DELETE')     as "delete",
  has_table_privilege(role, 'public.vault_notes', 'TRUNCATE')   as "truncate",
  has_table_privilege(role, 'public.vault_notes', 'REFERENCES') as "references",
  has_table_privilege(role, 'public.vault_notes', 'TRIGGER')    as "trigger"
from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
order by role;

-- 1-3. 칸 단위 권한 (테이블 권한과 따로 남을 수 있음)
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'vault_notes'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, column_name, privilege_type;

-- 1-4. 이 테이블을 다시 내보내는 뷰가 있는지 (있으면 따로 검토해야 함)
select view_schema, view_name
from information_schema.view_table_usage
where table_schema = 'public' and table_name = 'vault_notes';

-- 1-5. RLS 상태와 정책 (적용 뒤에도 그대로여야 함)
select relname, relrowsecurity as rls_enabled
from pg_class where oid = 'public.vault_notes'::regclass;
select policyname, cmd, roles
from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
order by policyname;

-- ===================== [2] 적용 =====================

begin;

-- 테이블 권한과 칸 단위 권한을 함께 거둡니다. service_role은 이 문장에 없으므로 그대로입니다.
revoke all on table public.vault_notes from public, anon, authenticated;
revoke all (id, owner_id, title, content, created_at) on table public.vault_notes
  from public, anon, authenticated;

commit;

-- ===================== [3] 적용 후 대조 =====================
-- 기대:
--   3-1 줄은 service_role 하나뿐(적용 전과 같은 권한). PUBLIC·anon·authenticated 줄 없음
--   3-2 anon·authenticated: 일곱 칸 모두 false / service_role: 적용 전과 같음
--   3-3 줄 없음
--   3-4 rls_enabled = true, 정책 4개 그대로

-- 3-1
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'vault_notes'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by grantee
order by grantee;

-- 3-2
select role,
  has_table_privilege(role, 'public.vault_notes', 'SELECT')     as "select",
  has_table_privilege(role, 'public.vault_notes', 'INSERT')     as "insert",
  has_table_privilege(role, 'public.vault_notes', 'UPDATE')     as "update",
  has_table_privilege(role, 'public.vault_notes', 'DELETE')     as "delete",
  has_table_privilege(role, 'public.vault_notes', 'TRUNCATE')   as "truncate",
  has_table_privilege(role, 'public.vault_notes', 'REFERENCES') as "references",
  has_table_privilege(role, 'public.vault_notes', 'TRIGGER')    as "trigger"
from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
order by role;

-- 3-3
select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'vault_notes'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, column_name, privilege_type;

-- 3-4
select relname, relrowsecurity as rls_enabled
from pg_class where oid = 'public.vault_notes'::regclass;
select policyname, cmd, roles
from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
order by policyname;
