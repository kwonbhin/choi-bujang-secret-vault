-- 4단계: vault_notes 한 테이블에만 RLS 본인 행 정책과 최소 권한을 적용합니다.
-- Supabase 대시보드 > SQL Editor에서 검토한 뒤 실행합니다. 키나 비밀번호는 필요하지 않습니다.
-- 다른 테이블은 건드리지 않습니다. service_role의 기존 권한은 바꾸지 않습니다
-- (서버 함수는 service_role로 동작하며 RLS를 거치지 않고, API 코드가 소유자를 검사합니다).
-- 순서: [1] 적용 전 대조 → [2] 적용(한 트랜잭션) → [3] 적용 후 대조. 다시 실행해도 됩니다.

-- ===================== [1] 적용 전 대조 =====================

-- 1-1. 명시적으로 받은 권한 (grantee별)
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

-- 1-3. RLS 상태와 정책
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.vault_notes'::regclass;
select policyname, cmd, roles, qual as using_expr, with_check as with_check_expr
from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
order by policyname;

-- ===================== [2] 적용 =====================

begin;

alter table public.vault_notes enable row level security;

-- 기존 권한 회수: PUBLIC, anon, authenticated만. service_role은 그대로 둡니다.
revoke all on table public.vault_notes from public, anon, authenticated;

-- authenticated에 필요한 네 가지만. TRUNCATE·REFERENCES·TRIGGER는 주지 않습니다.
-- anon에는 아무 권한도 주지 않습니다.
grant select, insert, update, delete on table public.vault_notes to authenticated;

-- 본인 행 정책. auth.uid()는 (select ...)로 감싸 행마다 다시 계산하지 않게 합니다.
-- owner_id가 비어 있는 행은 누구의 정책에도 맞지 않습니다.
drop policy if exists vault_notes_select_own on public.vault_notes;
drop policy if exists vault_notes_insert_own on public.vault_notes;
drop policy if exists vault_notes_update_own on public.vault_notes;
drop policy if exists vault_notes_delete_own on public.vault_notes;

-- SELECT: 기존 행
create policy vault_notes_select_own on public.vault_notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- INSERT: 새 행
create policy vault_notes_insert_own on public.vault_notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

-- UPDATE: 기존 행(USING)과 바뀐 새 행(WITH CHECK) 모두 본인 것이어야 합니다.
-- 그래서 owner_id를 남의 ID로 바꾸는 수정도 거부됩니다.
create policy vault_notes_update_own on public.vault_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- DELETE: 기존 행
create policy vault_notes_delete_own on public.vault_notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;

-- ===================== [3] 적용 후 대조 =====================
-- 기대:
--   3-1 anon: 줄 없음 / authenticated: DELETE, INSERT, SELECT, UPDATE / PUBLIC: 줄 없음
--       service_role: 적용 전과 같음
--   3-2 anon: 모두 false / authenticated: select·insert·update·delete만 true
--       service_role: 적용 전과 같음
--   3-3 rls_enabled = true, 정책 4개(SELECT·INSERT·UPDATE·DELETE), roles = {authenticated}

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
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class where oid = 'public.vault_notes'::regclass;
select policyname, cmd, roles, qual as using_expr, with_check as with_check_expr
from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
order by policyname;
