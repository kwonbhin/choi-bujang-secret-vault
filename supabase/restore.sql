-- 10단계: 메모 사본(vault_notes_snapshot)과 복구 감사 기록(vault_restore_audit)을 만듭니다.
-- 학생 설계(계약에 없음). 10단계 계약이 없어 테이블·칸·해시 방법은 학생이 정했습니다.
-- Supabase 대시보드 > SQL Editor에서 실행합니다. 키나 비밀번호는 필요하지 않습니다. 여러 번 실행해도 됩니다.
-- 실행 순서: supabase/restore-check.sql(확인) → 이 파일 → supabase/restore-snapshot-existing.sql(기존 메모 사본)
-- vault_notes 테이블·권한·RLS 정책은 바꾸지 않고, AFTER INSERT 트리거 하나만 더합니다.

begin;

-- 내용 해시: SHA-256( UTF-8(title) || 0x00 || UTF-8(content) ) 소문자 16진수.
-- src/content-hash.mjs의 noteSha256(title, content)와 같은 값입니다.
-- 함수 두 개 모두 search_path를 ''로 고정하고, 안에서 쓰는 이름에는 public. / pg_catalog. 스키마를 붙였습니다.
create or replace function public.vault_note_sha256(p_title text, p_content text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_title, 'UTF8') || '\x00'::bytea || pg_catalog.convert_to(p_content, 'UTF8')), 'hex')
$$;

-- 사본: vault_notes의 실제 칸(id, owner_id, title, content, created_at)에 해시와 사본 시각을 더합니다.
-- id는 primary key라 unique입니다. 메모 한 건에 사본은 처음 한 번만 생깁니다.
create table if not exists public.vault_notes_snapshot (
  id uuid primary key,
  owner_id uuid,
  title text not null,
  content text not null,
  created_at timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_at timestamptz not null default now()
);

-- 감사 기록: 메모 내용과 토큰은 넣지 않습니다. 누가(로그인 사용자 ID) 어느 메모를 어떤 결과로 복구했는지만 남깁니다.
create table if not exists public.vault_restore_audit (
  audit_id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid not null,
  note_id uuid,
  outcome text not null check (outcome ~ '^[a-z_]{1,40}$'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  matched boolean
);

-- 두 테이블 모두 만든 직후 PUBLIC·anon·authenticated·service_role 권한을 거두고 RLS를 켭니다(정책 없음).
revoke all on table public.vault_notes_snapshot from public, anon, authenticated, service_role;
revoke all on table public.vault_restore_audit from public, anon, authenticated, service_role;
alter table public.vault_notes_snapshot enable row level security;
alter table public.vault_restore_audit enable row level security;

-- service_role(서버 함수)에는 필요한 권한만 줍니다.
-- 사본: 읽기만. 사본을 쓰는 일은 아래 트리거 함수(소유자 권한)만 합니다. 서버 키로도 사본을 고치거나 지울 수 없습니다.
-- 감사 기록: insert와 select만. update·delete는 주지 않습니다.
grant select on table public.vault_notes_snapshot to service_role;
grant select, insert on table public.vault_restore_audit to service_role;

-- 새 메모가 생기는 순간 사본을 뜹니다. 같은 id 사본이 있으면 아무것도 하지 않습니다.
-- UPDATE·DELETE에는 트리거를 걸지 않습니다. 변조·삭제를 당해도 처음 검증한 내용이 남아야 하기 때문입니다.
create or replace function public.vault_notes_snapshot_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.vault_notes_snapshot (id, owner_id, title, content, created_at, content_sha256)
  values (new.id, new.owner_id, new.title, new.content, new.created_at,
          public.vault_note_sha256(new.title, new.content))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Supabase는 새 함수에 실행 권한을 기본으로 줍니다. Data API(RPC)로 부르지 못하게 모두 거둡니다.
revoke all on function public.vault_note_sha256(text, text) from public, anon, authenticated, service_role;
revoke all on function public.vault_notes_snapshot_on_insert() from public, anon, authenticated, service_role;

drop trigger if exists vault_notes_snapshot_after_insert on public.vault_notes;
create trigger vault_notes_snapshot_after_insert
  after insert on public.vault_notes
  for each row execute function public.vault_notes_snapshot_on_insert();

commit;

-- 실행 뒤 확인(읽기 전용). SQL Editor는 마지막 결과 표만 보여 주므로 select 한 번에 (항목, 값) 표로 모았습니다.
-- 항목 이름의 괄호 안이 기대값입니다.
select "항목", "값"
from (
  -- [1] 두 테이블의 권한
  select 1 as ord, r.ord as sub,
         '1 권한 ' || r.tbl || ' ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = r.tbl and g.grantee = r.grantee), '없음') as "값"
  from (values
    (1, 'vault_notes_snapshot', 'PUBLIC', ' (기대: 없음)'),
    (2, 'vault_notes_snapshot', 'anon', ' (기대: 없음)'),
    (3, 'vault_notes_snapshot', 'authenticated', ' (기대: 없음)'),
    (4, 'vault_notes_snapshot', 'service_role', ' (기대: SELECT)'),
    (5, 'vault_restore_audit', 'PUBLIC', ' (기대: 없음)'),
    (6, 'vault_restore_audit', 'anon', ' (기대: 없음)'),
    (7, 'vault_restore_audit', 'authenticated', ' (기대: 없음)'),
    (8, 'vault_restore_audit', 'service_role', ' (기대: INSERT, SELECT)'),
    (9, 'vault_notes', 'anon', ' (기대: 없음, 바뀌지 않음)'),
    (10, 'vault_notes', 'authenticated', ' (기대: 없음, 바뀌지 않음)'),
    (11, 'vault_notes', 'service_role', ' (기대: DELETE, INSERT, SELECT, UPDATE, 바뀌지 않음)')
  ) as r(ord, tbl, grantee, expected)

  union all
  -- [2] RLS
  select 2, 1, '2 RLS 켜짐 vault_notes_snapshot (기대: true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes_snapshot'::regclass)
  union all
  select 2, 2, '2 RLS 켜짐 vault_restore_audit (기대: true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_restore_audit'::regclass)
  union all
  select 2, 3, '2 vault_notes 정책 수 (기대: 4, 바뀌지 않음)',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'vault_notes')

  union all
  -- [3] 트리거
  select 3, 0, '3 vault_notes 트리거 (기대: vault_notes_snapshot_after_insert AFTER INSERT 하나)',
         coalesce((select string_agg(tgname || ' ' || case when tgtype & 2 = 2 then 'BEFORE' else 'AFTER' end
                                     || case when tgtype & 4 = 4 then ' INSERT' else '' end
                                     || case when tgtype & 8 = 8 then ' DELETE' else '' end
                                     || case when tgtype & 16 = 16 then ' UPDATE' else '' end, ', ' order by tgname)
                   from pg_trigger where tgrelid = 'public.vault_notes'::regclass and not tgisinternal), '없음')

  union all
  -- [4] 함수 실행 권한 (Data API RPC로 부를 수 없어야 함)
  select 4, r.ord, '4 함수 실행 ' || r.fn || ' ' || r.role || ' (기대: false)',
         has_function_privilege(r.role, r.sig, 'EXECUTE')::text
  from (values
    (1, 'vault_note_sha256', 'public.vault_note_sha256(text, text)', 'anon'),
    (2, 'vault_note_sha256', 'public.vault_note_sha256(text, text)', 'authenticated'),
    (3, 'vault_note_sha256', 'public.vault_note_sha256(text, text)', 'service_role'),
    (4, 'vault_notes_snapshot_on_insert', 'public.vault_notes_snapshot_on_insert()', 'anon'),
    (5, 'vault_notes_snapshot_on_insert', 'public.vault_notes_snapshot_on_insert()', 'authenticated'),
    (6, 'vault_notes_snapshot_on_insert', 'public.vault_notes_snapshot_on_insert()', 'service_role')
  ) as r(ord, fn, sig, role)
) as checks
order by ord, sub;
