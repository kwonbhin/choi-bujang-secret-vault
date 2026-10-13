-- 10단계 실행 전 확인용(읽기 전용). 학생 설계(계약에 없음).
-- 아무것도 바꾸지 않습니다. supabase/restore.sql을 실행하기 전에 SQL Editor에서 실행해 결과를 남겨 두세요.
-- SQL Editor는 마지막 결과 표만 보여 주므로, 모든 확인값을 select 한 번에 (항목, 값) 표로 모았습니다.
-- 항목 이름의 괄호 안이 기대값입니다.
-- B 계정의 메모 개수는 이메일이 필요하므로 Git에 올리지 않는 supabase/restore-check-b.local.sql에 따로 있습니다.

select "항목", "값"
from (
  -- [1] vault_notes 테이블 권한
  select 1 as ord, r.ord as sub,
         '1 테이블 권한 ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_notes' and g.grantee = r.grantee), '없음') as "값"
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: DELETE, INSERT, SELECT, UPDATE)')) as r(ord, grantee, expected)

  union all
  -- [2] 칸 단위 권한
  select 2, 0, '2 칸 단위 권한 PUBLIC·anon·authenticated (기대: 없음)',
         coalesce((select string_agg(c.grantee || ':' || c.column_name || ':' || c.privilege_type, ', '
                                     order by c.grantee, c.column_name, c.privilege_type)
                   from information_schema.column_privileges c
                   where c.table_schema = 'public' and c.table_name = 'vault_notes'
                     and c.grantee in ('PUBLIC', 'anon', 'authenticated')), '없음')

  union all
  -- [3] RLS와 정책
  select 3, 1, '3 RLS 켜짐 (기대: true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass)
  union all
  select 3, 2, '3 정책 이름 (기대: 4단계 본인 행 정책 4개)',
         coalesce((select count(*) || '개: ' || string_agg(policyname, ', ' order by policyname)
                   from pg_policies where schemaname = 'public' and tablename = 'vault_notes'
                   having count(*) > 0), '없음')

  union all
  -- [4] 실제 칸
  select 4, 0, '4 칸 이름 (기대: id, owner_id, title, content, created_at)',
         (select string_agg(column_name, ', ' order by ordinal_position)
          from information_schema.columns where table_schema = 'public' and table_name = 'vault_notes')

  union all
  -- [5] 트리거와 10단계 테이블
  select 5, 1, '5 vault_notes 트리거 (처음 실행이면 기대: 없음)',
         coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                   where tgrelid = 'public.vault_notes'::regclass and not tgisinternal), '없음')
  union all
  select 5, 2, '5 사본 테이블 vault_notes_snapshot (처음 실행이면 기대: 없음)',
         coalesce(to_regclass('public.vault_notes_snapshot')::text, '없음')
  union all
  select 5, 3, '5 감사 기록 테이블 vault_restore_audit (처음 실행이면 기대: 없음)',
         coalesce(to_regclass('public.vault_restore_audit')::text, '없음')

  union all
  -- [6] 전체 메모 수 (내용은 보지 않습니다)
  select 6, 0, '6 메모 수', (select count(*)::text from public.vault_notes)
) as checks
order by ord, sub;
