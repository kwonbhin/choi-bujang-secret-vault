-- 12단계: 회수된 신원 등록부(vault_revoked_identities)와 작전실용 정책 사본 버전 읽기 함수. 학생 설계(계약에 없음).
-- 학생이 Supabase 대시보드 > SQL Editor에서 직접 실행합니다. 키·비밀번호·이메일·사용자 번호는 필요 없고 저장하지 않습니다.
-- 여러 번 실행해도 됩니다(표·함수는 있으면 그대로 두거나 같은 내용으로 다시 만듭니다. 회수 행은 지우지 않습니다).
--
-- ★ 코드 배포 전에 실행하세요. 보호 API(메모·복구·기기·작전실)는 이 표를 읽지 못하면 503으로 닫습니다(fail-closed).
--    이 파일 없이 12단계 코드가 배포되면 학생·심판 요청 모두 503 IDENTITY_CHECK_UNAVAILABLE입니다.
--
-- 신원 키: 서버 함수가 토큰의 사용자 ID(sub)를 서버 전용 키에서 HKDF(라벨 "vault-identity-revocation-v1")로 뽑은 키로
--   HMAC-SHA256한 64자 16진수입니다(src/identity-revocation.mjs). DB는 키를 모르고, 원본 사용자 ID는 표에 남지 않습니다.
--   회수할 신원의 키는 그 신원으로 로그인한 「탈환 작전실」 화면의 "신원 회수 키"에서 확인합니다(본인 범위만 보임).
-- 이 파일은 vault_notes·사본·봉인·감사 기록·기기 등록부·10단계 정책 표의 내용과 권한을 바꾸지 않습니다.

begin;

create table if not exists public.vault_revoked_identities (
  identity_key text primary key check (identity_key ~ '^[0-9a-f]{64}$'),
  reason text not null default '' check (length(reason) <= 80),
  revoked_at timestamptz not null default now(),
  released_at timestamptz
);

-- RLS를 켜고(정책 없음) PUBLIC·anon·authenticated 권한을 모두 거둡니다. service_role(서버 함수)은 읽기만 합니다.
-- 회수·해제는 SQL Editor(소유자)에서만 합니다.
alter table public.vault_revoked_identities enable row level security;
revoke all on table public.vault_revoked_identities from public, anon, authenticated, service_role;
grant select on table public.vault_revoked_identities to service_role;

-- 작전실(GET /api/ops/summary)이 DB 정책 사본 버전을 읽는 함수: 버전 이름과 뜬 시각만 돌려줍니다(사본 내용은 주지 않음).
-- 10단계 표 vault_policy_backup의 권한은 그대로이고, 이 함수만 service_role이 실행할 수 있습니다.
create or replace function public.vault_policy_backup_versions()
returns table (version text, captured_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.version, b.captured_at from public.vault_policy_backup b order by b.captured_at desc limit 5;
$$;
revoke all on function public.vault_policy_backup_versions() from public, anon, authenticated, service_role;
grant execute on function public.vault_policy_backup_versions() to service_role;

commit;

-- 확인(읽기 전용, select 하나의 표). 항목 이름의 괄호 안이 기대값입니다. 신원 키 값은 읽지 않습니다.
select "항목", "값" from (
  select 1 as ord, r.ord as sub, '1 회수 표 권한 ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_revoked_identities' and g.grantee = r.grantee), '없음') as "값"
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: SELECT)')) as r(ord, grantee, expected)
  union all
  select 2, 1, '2 RLS 켜짐 (기대: true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_revoked_identities'::regclass)
  union all
  select 3, 1, '3 정책 사본 버전 함수 실행 권한 anon / authenticated / service_role (기대: false / false / true)',
         has_function_privilege('anon', 'public.vault_policy_backup_versions()', 'EXECUTE')::text || ' / '
         || has_function_privilege('authenticated', 'public.vault_policy_backup_versions()', 'EXECUTE')::text || ' / '
         || has_function_privilege('service_role', 'public.vault_policy_backup_versions()', 'EXECUTE')::text
  union all
  select 4, 1, '4 회수 중 / 해제된 신원 수',
         (select count(*) filter (where released_at is null)::text || ' / '
                 || count(*) filter (where released_at is not null)::text from public.vault_revoked_identities)
  union all
  select 5, 1, '5 정책 사본 버전 (10단계 s9-safe-1이 있어야 함)',
         coalesce((select string_agg(v.version, ', ') from public.vault_policy_backup_versions() v), '없음')
  union all
  select 6, 1, '6 vault_notes RLS 켜짐 / 정책 수 (기대: true / 4, 바뀌지 않음)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass) || ' / '
         || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'vault_notes')
) as checks
order by ord, sub;

-- ─────────────────────────────────────────────────────────────────────────────
-- 학생이 SQL Editor에서 직접 하는 신원 회수 (이 앱에는 회수·해제 API가 없습니다)
-- 아래 줄의 맨 앞 "-- "를 지우고 한 덩어리씩 실행합니다. <신원 키>는 「탈환 작전실」의 "신원 회수 키"(64자 16진수)입니다.
-- 사유에는 이름·이메일·메모 내용을 쓰지 마세요(예: '9단계 탐지 제안', '시험').
--
-- [목록] 회수 행(키는 앞 12자만)
-- select left(identity_key, 12) as key_prefix, reason, revoked_at, released_at
-- from public.vault_revoked_identities order by revoked_at desc limit 20;
--
-- [회수] 이 신원의 모든 보호 API 요청을 403 identity_revoked로 닫습니다(다음 요청부터).
--        이미 있으면 해제를 지우고 다시 회수합니다.
-- insert into public.vault_revoked_identities (identity_key, reason)
-- values ('<신원 키>', '<사유>')
-- on conflict (identity_key) do update set released_at = null, revoked_at = now(), reason = excluded.reason
-- returning left(identity_key, 12) as key_prefix, revoked_at, released_at;
--
-- [해제] 회수를 풉니다(행은 남기고 해제 시각만 적음).
-- update public.vault_revoked_identities set released_at = now()
-- where identity_key = '<신원 키>' and released_at is null
-- returning left(identity_key, 12) as key_prefix, revoked_at, released_at;
