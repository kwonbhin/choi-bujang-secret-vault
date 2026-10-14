-- 10단계: 메모 사본 봉인 표(vault_notes_backup_seal). 학생 설계(계약에 없음).
-- 학생이 Supabase 대시보드 > SQL Editor에서 직접 실행합니다. 키·비밀번호·메모 내용·이메일은 필요 없고 다루지 않습니다.
-- 여러 번 실행해도 됩니다(표·트리거는 있으면 그대로 두거나 같은 내용으로 다시 만듭니다. 봉인 행은 지우지 않습니다).
--
-- 실행 순서
--   1. supabase/restore.sql                (이미 실행함) 사본 표 vault_notes_snapshot과 AFTER INSERT 트리거
--   2. 이 파일                              봉인 표·권한·트리거, 마지막에 확인 표
--   3. 코드 배포(커밋 「10단계: 사본 봉인(서버 키 HMAC) 검증」) 뒤 새로 만든 메모부터 봉인이 생깁니다.
--      기존 메모는 봉인이 없어 복구가 409 BACKUP_VERIFICATION_FAILED(backup.sealed false)로 멈춥니다(설계대로).
--
-- 봉인 값: 서버 함수가 서버 전용 키(SUPABASE_SECRET_KEY)에서 HKDF-SHA256(라벨 "vault-backup-seal-v1")로 뽑은 키로
--   HMAC-SHA256(note_id | owner_id | content_sha256)을 계산해 넣습니다(src/backup-seal.mjs). DB는 키를 모르고 값만 보관합니다.
--   그래서 사본 행과 그 해시를 함께 바꿔도, 서버 키 없이는 맞는 봉인을 만들 수 없습니다.
-- 이 파일은 vault_notes·vault_notes_snapshot·감사 기록·다른 정책을 바꾸지 않습니다.

begin;

create table if not exists public.vault_notes_backup_seal (
  note_id uuid primary key,
  owner_id uuid,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  seal text not null check (seal ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz not null default now()
);

-- RLS를 켜고(정책 없음) PUBLIC·anon·authenticated 권한을 모두 거둡니다.
-- service_role(서버 함수)에는 insert·select만 줍니다. update·delete·truncate는 주지 않고 트리거로도 막습니다.
alter table public.vault_notes_backup_seal enable row level security;
revoke all on table public.vault_notes_backup_seal from public, anon, authenticated, service_role;
grant select, insert on table public.vault_notes_backup_seal to service_role;

-- 봉인 보존: 추가만 됩니다. UPDATE·DELETE(행)·TRUNCATE(문장)는 트리거로 막습니다(소유자도 막힘).
create or replace function public.vault_notes_backup_seal_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% 표는 추가만 할 수 있습니다(%).', tg_table_name, tg_op using errcode = '42501';
end;
$$;
revoke all on function public.vault_notes_backup_seal_block_change() from public, anon, authenticated, service_role;

drop trigger if exists vault_notes_backup_seal_no_change on public.vault_notes_backup_seal;
create trigger vault_notes_backup_seal_no_change before update or delete on public.vault_notes_backup_seal
  for each row execute function public.vault_notes_backup_seal_block_change();
drop trigger if exists vault_notes_backup_seal_no_truncate on public.vault_notes_backup_seal;
create trigger vault_notes_backup_seal_no_truncate before truncate on public.vault_notes_backup_seal
  for each statement execute function public.vault_notes_backup_seal_block_change();

commit;

-- 확인(읽기 전용, select 하나의 표). 항목 이름의 괄호 안이 기대값입니다. 봉인 값과 메모 내용은 읽지 않습니다.
select "항목", "값" from (
  select 1 as ord, r.ord as sub, '1 권한 ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_notes_backup_seal' and g.grantee = r.grantee), '없음') as "값"
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: INSERT, SELECT)')) as r(ord, grantee, expected)
  union all
  select 2, 1, '2 RLS 켜짐 (기대: true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes_backup_seal'::regclass)
  union all
  select 3, 1, '3 수정·삭제·비우기 막는 트리거 (기대: 2개, UPDATE·DELETE 행 / TRUNCATE 문장)',
         (select count(*)::text || '개: ' || string_agg(tgname, ', ' order by tgname) from pg_trigger
          where tgrelid = 'public.vault_notes_backup_seal'::regclass and not tgisinternal)
  union all
  select 4, 1, '4 트리거 함수 실행 권한 anon·authenticated·service_role (기대: 모두 false)',
         (select string_agg(r.role || ' ' || has_function_privilege(r.role, 'public.vault_notes_backup_seal_block_change()', 'EXECUTE')::text, ', ' order by r.role)
          from (values ('anon'), ('authenticated'), ('service_role')) r(role))
  union all
  select 5, 1, '5 봉인 칸 (기대: note_id, owner_id, content_sha256, seal, sealed_at)',
         (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
          where table_schema = 'public' and table_name = 'vault_notes_backup_seal')
  union all
  select 6, 1, '6 봉인 수 / 사본 수 / 봉인 없는 메모 수 (배포 전 기존 메모는 봉인 없음)',
         (select count(*) from public.vault_notes_backup_seal)::text || ' / '
         || (select count(*) from public.vault_notes_snapshot)::text || ' / '
         || (select count(*) from public.vault_notes n
             where not exists (select 1 from public.vault_notes_backup_seal s where s.note_id = n.id))::text
  union all
  select 7, 1, '7 vault_notes RLS 켜짐 / 정책 수 (기대: true / 4, 바뀌지 않음)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass) || ' / '
         || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'vault_notes')
) as checks
order by ord, sub;
