-- 10단계: 안전 정책 사본을 기준으로 vault_notes의 DB 권한을 되돌립니다. 학생 설계(계약에 없음).
-- 기준: 9단계 커밋 23fce0d의 supabase/notes-revoke-direct.sql (git show 23fce0d:supabase/notes-revoke-direct.sql로 확인)
--   → vault_notes에는 PUBLIC·anon·authenticated의 테이블 권한과 칸 단위 권한이 없어야 합니다.
-- 하는 일: vault_notes에서 PUBLIC·anon·authenticated의 테이블 권한과 모든 칸의 칸 단위 권한만 거둡니다.
-- 하지 않는 일: service_role 권한, RLS 켜짐 여부, RLS 정책 4개, 다른 테이블, 함수, 트리거는 건드리지 않습니다.
-- Supabase 대시보드 > SQL Editor에서 실행합니다. 키나 비밀번호는 필요하지 않습니다. 여러 번 실행해도 됩니다.

begin;

-- 테이블 권한
revoke all on table public.vault_notes from public, anon, authenticated;

-- 칸 단위 권한: 기준 사본의 다섯 칸뿐 아니라 지금 있는 모든 칸에서 거둡니다(칸이 더해졌어도 남지 않게).
do $$
declare
  col record;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'vault_notes'
  loop
    execute format('revoke all (%I) on table public.vault_notes from public, anon, authenticated', col.column_name);
  end loop;
end;
$$;

commit;

-- 되돌린 뒤 상태(읽기 전용). SQL Editor는 마지막 결과 표만 보여 주므로 select 한 번에 (항목, 값) 표로 모았습니다.
-- 항목 이름의 괄호 안이 기대값(기준 사본의 상태)입니다.
select "항목", "값"
from (
  select 1 as ord, r.ord as sub,
         '1 테이블 권한 ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_notes' and g.grantee = r.grantee), '없음') as "값"
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: DELETE, INSERT, SELECT, UPDATE, 그대로)')) as r(ord, grantee, expected)

  union all
  select 2, 0, '2 칸 단위 권한 PUBLIC·anon·authenticated (기대: 없음)',
         coalesce((select string_agg(c.grantee || ':' || c.column_name || ':' || c.privilege_type, ', '
                                     order by c.grantee, c.column_name, c.privilege_type)
                   from information_schema.column_privileges c
                   where c.table_schema = 'public' and c.table_name = 'vault_notes'
                     and c.grantee in ('PUBLIC', 'anon', 'authenticated')), '없음')

  union all
  select 3, r.ord, '3 실제로 쓸 수 있는지 ' || r.role || ' (기대: 모두 false)',
         'select ' || has_table_privilege(r.role, 'public.vault_notes', 'SELECT')
         || ', insert ' || has_table_privilege(r.role, 'public.vault_notes', 'INSERT')
         || ', update ' || has_table_privilege(r.role, 'public.vault_notes', 'UPDATE')
         || ', delete ' || has_table_privilege(r.role, 'public.vault_notes', 'DELETE')
         || ', 칸 단위 ' || has_any_column_privilege(r.role, 'public.vault_notes', 'SELECT, INSERT, UPDATE, REFERENCES')
  from (values (1, 'anon'), (2, 'authenticated')) as r(ord, role)

  union all
  select 4, 1, '4 RLS 켜짐 (기대: true, 그대로)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass)
  union all
  select 4, 2, '4 정책 이름 (기대: 4단계 본인 행 정책 4개, 그대로)',
         coalesce((select count(*) || '개: ' || string_agg(policyname, ', ' order by policyname)
                   from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
                   having count(*) > 0), '없음')
) as checks
order by ord, sub;
