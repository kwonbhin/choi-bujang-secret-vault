-- 10단계: DB 안전 정책(vault_notes의 RLS·정책·권한) 사본·검증·차이·복원. 학생 설계(계약에 없음).
-- 학생이 Supabase 대시보드 > SQL Editor에서 직접 실행합니다. 키·비밀번호·메모 내용·이메일은 필요 없고 다루지 않습니다.
-- 여러 번 실행해도 됩니다(표·함수·트리거는 있으면 그대로 두거나 같은 내용으로 다시 만들고, 사본은 같은 버전을 덮어쓰지 않습니다).
--
-- 실행 순서
--   1. supabase/restore-check.sql        (읽기 전용) vault_notes 권한·RLS·정책 4개가 기준과 같은지 먼저 봅니다.
--      기준과 다르면 supabase/policy-restore-db.sql로 권한을 먼저 되돌리고 1을 다시 봅니다.
--   2. 이 파일                            표·함수·트리거를 만들고, 마지막에 침해 전 사본 's9-safe-1'을 한 번 남깁니다.
--      지금 정책이 안전 기준과 다르면 사본을 남기지 않고 거부합니다(마지막 표의 "사본 남기기" 줄).
--   3. supabase/step10_policy_restore_test.sql  한 트랜잭션 안에서 침공 흉내 → 미리보기 → 복원 → 확인. 실패하면 전부 취소.
--   필요할 때(SQL Editor에서만):
--      select public.vault_policy_verify('s9-safe-1');            사본을 다시 읽어 해시 재계산 검증
--      select public.vault_policy_diff('s9-safe-1');              읽기 전용: 버전과 바뀔 항목
--      select public.vault_policy_restore('s9-safe-1', false);    미리보기: 버전과 바뀔 항목만(아무것도 안 바꿈)
--      select public.vault_policy_restore('s9-safe-1', true);     확인: 다시 검증 → vault_notes 정책·권한만 사본대로 → 다시 읽어 대조
--
-- 안전 기준(침해 전): RLS 켜짐, supabase/notes-rls.sql의 본인 행 정책 4개(vault_notes_select_own·insert_own·update_own·delete_own,
--   authenticated, (select auth.uid()) = owner_id), PUBLIC·anon·authenticated의 테이블 권한과 칸 단위 권한 없음
--   (supabase/notes-revoke-direct.sql). service_role 권한은 지금 값을 그대로 사본에 담습니다.
-- 사본 's9-safe-1'은 판정기(src/decider.mjs)의 restore_verified_policy가 허용하는 정책 버전 1(policyRevision 1)에 대응하는
--   DB 쪽 안전 정책입니다. 판정기는 DB를 읽지 않으므로 이 연결은 이름과 설명으로만 맞춥니다.
-- 이 파일이 바꾸는 것: 새 표 2개(vault_policy_backup, vault_policy_audit)와 그 트리거, 새 함수.
--   vault_notes의 정책·권한은 vault_policy_restore(…, true)를 부를 때만, 사본대로만 바꿉니다.
--   다른 표(vault_notes_snapshot, vault_restore_audit 등)의 정책·사본·감사 기록은 읽지도 바꾸지도 않습니다.

begin;

-- ===================== 표 =====================
create table if not exists public.vault_policy_backup (
  version text primary key check (version ~ '^[a-z0-9][a-z0-9_.-]{0,40}$'),
  snapshot jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default now()
);

create table if not exists public.vault_policy_audit (
  audit_id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action ~ '^[a-z_]{1,40}$'),
  version text,
  outcome text not null check (outcome ~ '^[a-z_]{1,60}$'),
  detail jsonb not null default '{}'::jsonb
);

-- 두 표 모두 RLS를 켜고(정책 없음) PUBLIC·anon·authenticated·service_role의 권한을 모두 거둡니다. SQL Editor(소유자)만 씁니다.
alter table public.vault_policy_backup enable row level security;
alter table public.vault_policy_audit enable row level security;
revoke all on table public.vault_policy_backup from public, anon, authenticated, service_role;
revoke all on table public.vault_policy_audit from public, anon, authenticated, service_role;

-- 사본·감사 보존: 두 표는 추가만 됩니다. UPDATE·DELETE·TRUNCATE는 트리거로 막습니다(소유자도 막힘).
create or replace function public.vault_policy_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% 표는 추가만 할 수 있습니다(%).', tg_table_name, tg_op using errcode = '42501';
end;
$$;

drop trigger if exists vault_policy_backup_no_change on public.vault_policy_backup;
create trigger vault_policy_backup_no_change before update or delete on public.vault_policy_backup
  for each row execute function public.vault_policy_block_change();
drop trigger if exists vault_policy_backup_no_truncate on public.vault_policy_backup;
create trigger vault_policy_backup_no_truncate before truncate on public.vault_policy_backup
  for each statement execute function public.vault_policy_block_change();
drop trigger if exists vault_policy_audit_no_change on public.vault_policy_audit;
create trigger vault_policy_audit_no_change before update or delete on public.vault_policy_audit
  for each row execute function public.vault_policy_block_change();
drop trigger if exists vault_policy_audit_no_truncate on public.vault_policy_audit;
create trigger vault_policy_audit_no_truncate before truncate on public.vault_policy_audit
  for each statement execute function public.vault_policy_block_change();

-- ===================== 함수 =====================
-- 모두 security definer, search_path ''. 이름에는 public. 을 붙였습니다(pg_catalog는 항상 먼저 찾습니다).

-- 지금 vault_notes의 RLS·정책·권한을 jsonb로 읽습니다. 배열은 정렬해 같은 상태면 같은 jsonb가 나옵니다.
create or replace function public.vault_policy_current()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (select c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
             from pg_catalog.pg_class c where c.oid = 'public.vault_notes'::regclass),
  roles(role) as (values ('PUBLIC'), ('anon'), ('authenticated'), ('service_role')),
  table_acl as (
    select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as role, a.privilege_type
    from t, pg_catalog.aclexplode(coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) a
  ),
  column_acl as (
    select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as role,
           a.privilege_type || ':' || att.attname as item
    from t join pg_catalog.pg_attribute att on att.attrelid = t.oid and att.attnum > 0 and not att.attisdropped
         cross join lateral pg_catalog.aclexplode(att.attacl) a
    where att.attacl is not null
  )
  select jsonb_build_object(
    'table', 'public.vault_notes',
    'rls_enabled', t.relrowsecurity,
    'rls_forced', t.relforcerowsecurity,
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.polname,
        'command', case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
        'permissive', p.polpermissive,
        'roles', (select jsonb_agg(x.name order by x.name)
                  from (select case when r = 0 then 'public' else pg_catalog.pg_get_userbyid(r)::text end as name
                        from unnest(p.polroles) as r) x),
        'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
        'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
      ) order by p.polname)
      from pg_catalog.pg_policy p where p.polrelid = t.oid), '[]'::jsonb),
    'grants', (select jsonb_object_agg(r.role, coalesce((
                 select jsonb_agg(distinct ta.privilege_type order by ta.privilege_type)
                 from table_acl ta where ta.role = r.role), '[]'::jsonb)) from roles r),
    'column_grants', (select jsonb_object_agg(r.role, coalesce((
                 select jsonb_agg(distinct ca.item order by ca.item)
                 from column_acl ca where ca.role = r.role), '[]'::jsonb)) from roles r)
  )
  from t;
$$;

-- jsonb 내용의 SHA-256(소문자 16진수). jsonb의 글자 표현은 키 순서가 정해져 있어 같은 내용이면 같은 값입니다.
create or replace function public.vault_policy_sha256(p_snapshot jsonb)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_snapshot::text, 'UTF8')), 'hex')
$$;

-- 안전 기준과 다른 점을 배열로 돌려줍니다(빈 배열이면 안전). 식은 공백·괄호를 빼고 비교합니다.
create or replace function public.vault_policy_problems(p_snapshot jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  problems jsonb := '[]'::jsonb;
  own text[] := array['selectauth.uidasuid=owner_id', 'auth.uid=owner_id'];
  expected jsonb := '{"vault_notes_select_own":"SELECT","vault_notes_insert_own":"INSERT","vault_notes_update_own":"UPDATE","vault_notes_delete_own":"DELETE"}';
  pol jsonb;
  norm_using text;
  norm_check text;
  r text;
begin
  if p_snapshot is null then
    return '["사본 없음"]'::jsonb;
  end if;
  if (p_snapshot ->> 'rls_enabled')::boolean is distinct from true then
    problems := problems || to_jsonb('RLS 꺼짐'::text);
  end if;
  if jsonb_array_length(coalesce(p_snapshot -> 'policies', '[]')) <> 4 then
    problems := problems || to_jsonb('정책 수가 4개가 아님'::text);
  end if;
  for pol in select * from jsonb_array_elements(coalesce(p_snapshot -> 'policies', '[]')) loop
    norm_using := lower(regexp_replace(coalesce(pol ->> 'using', ''), '[\s()]', '', 'g'));
    norm_check := lower(regexp_replace(coalesce(pol ->> 'with_check', ''), '[\s()]', '', 'g'));
    if not expected ? (pol ->> 'name') or expected ->> (pol ->> 'name') <> pol ->> 'command'
       or pol -> 'roles' <> '["authenticated"]'::jsonb or (pol ->> 'permissive')::boolean is distinct from true
       or (pol ->> 'command' in ('SELECT', 'UPDATE', 'DELETE') and not norm_using = any(own))
       or (pol ->> 'command' in ('INSERT', 'UPDATE') and not norm_check = any(own))
       or (pol ->> 'command' in ('SELECT', 'DELETE') and pol ->> 'with_check' is not null)
       or (pol ->> 'command' = 'INSERT' and pol ->> 'using' is not null) then
      problems := problems || to_jsonb('본인 행 정책과 다름: ' || coalesce(pol ->> 'name', '?'));
    end if;
  end loop;
  foreach r in array array['PUBLIC', 'anon', 'authenticated'] loop
    if jsonb_array_length(coalesce(p_snapshot -> 'grants' -> r, '[]')) > 0 then
      problems := problems || to_jsonb('테이블 권한 있음: ' || r);
    end if;
    if jsonb_array_length(coalesce(p_snapshot -> 'column_grants' -> r, '[]')) > 0 then
      problems := problems || to_jsonb('칸 단위 권한 있음: ' || r);
    end if;
  end loop;
  return problems;
end;
$$;

-- 지금 상태와 사본의 바뀔 항목: [{item, now, backup}]. 정책은 이름별, 권한은 역할별로 봅니다.
create or replace function public.vault_policy_changes(p_now jsonb, p_backup jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = ''
as $$
  with pol_now as (select e ->> 'name' as name, e from jsonb_array_elements(coalesce(p_now -> 'policies', '[]')) e),
       pol_bak as (select e ->> 'name' as name, e from jsonb_array_elements(coalesce(p_backup -> 'policies', '[]')) e),
       items as (
    select 1 as ord, 'rls_enabled' as item, p_now -> 'rls_enabled' as now, p_backup -> 'rls_enabled' as backup
    union all select 2, 'rls_forced', p_now -> 'rls_forced', p_backup -> 'rls_forced'
    union all
    select 3, 'policy:' || coalesce(n.name, b.name), n.e, b.e
    from pol_now n full join pol_bak b on b.name = n.name
    union all
    select 4, 'grant:' || k, p_now -> 'grants' -> k, p_backup -> 'grants' -> k
    from (select jsonb_object_keys(coalesce(p_backup -> 'grants', '{}')) as k
          union select jsonb_object_keys(coalesce(p_now -> 'grants', '{}'))) keys
    union all
    select 5, 'column_grant:' || k, p_now -> 'column_grants' -> k, p_backup -> 'column_grants' -> k
    from (select jsonb_object_keys(coalesce(p_backup -> 'column_grants', '{}')) as k
          union select jsonb_object_keys(coalesce(p_now -> 'column_grants', '{}'))) keys
  )
  select coalesce(jsonb_agg(jsonb_build_object('item', item, 'now', now, 'backup', backup) order by ord, item), '[]'::jsonb)
  from items where now is distinct from backup;
$$;

-- 감사 기록 한 줄(추가만).
create or replace function public.vault_policy_log(p_action text, p_version text, p_outcome text, p_detail jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.vault_policy_audit (action, version, outcome, detail)
  values (p_action, p_version, p_outcome, coalesce(p_detail, '{}'::jsonb))
  returning audit_id;
$$;

-- 사본을 다시 읽어 해시를 다시 계산합니다(감사 기록 없이 결과만). 없거나 다르거나 안전 기준이 아니면 ok false.
create or replace function public.vault_policy_check_backup(p_version text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.vault_policy_backup;
  recomputed text;
begin
  select * into b from public.vault_policy_backup where version = p_version;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'backup_missing', 'version', p_version);
  end if;
  recomputed := public.vault_policy_sha256(b.snapshot);
  if recomputed <> b.snapshot_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'backup_hash_mismatch', 'version', p_version);
  end if;
  if jsonb_array_length(public.vault_policy_problems(b.snapshot)) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'backup_not_safe', 'version', p_version,
                              'problems', public.vault_policy_problems(b.snapshot));
  end if;
  return jsonb_build_object('ok', true, 'version', b.version, 'captured_at', b.captured_at,
                            'sha256', b.snapshot_sha256, 'recomputed_sha256', recomputed,
                            'reread_at', clock_timestamp(), 'snapshot', b.snapshot);
end;
$$;

-- 침해 전 사본 남기기: 지금 정책이 안전 기준과 같을 때만. 같은 버전이 있으면 덮어쓰지 않습니다.
create or replace function public.vault_policy_capture(p_version text, p_policy_revision integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur jsonb := public.vault_policy_current();
  cur_sha text := public.vault_policy_sha256(cur);
  problems jsonb := public.vault_policy_problems(cur);
  existing public.vault_policy_backup;
  link jsonb := jsonb_build_object('decider_policy_revision', p_policy_revision);
begin
  if p_version is null or p_version !~ '^[a-z0-9][a-z0-9_.-]{0,40}$' then
    perform public.vault_policy_log('capture', null, 'rejected_bad_version', link);
    return jsonb_build_object('ok', false, 'outcome', 'rejected_bad_version');
  end if;
  if jsonb_array_length(problems) > 0 then
    perform public.vault_policy_log('capture', p_version, 'rejected_not_safe', link || jsonb_build_object('problems', problems));
    return jsonb_build_object('ok', false, 'outcome', 'rejected_not_safe', 'problems', problems);
  end if;
  select * into existing from public.vault_policy_backup where version = p_version;
  if found then
    if existing.snapshot_sha256 = cur_sha then
      perform public.vault_policy_log('capture', p_version, 'already_captured_same', link || jsonb_build_object('sha256', cur_sha));
      return jsonb_build_object('ok', true, 'outcome', 'already_captured_same', 'sha256', cur_sha, 'captured_at', existing.captured_at);
    end if;
    perform public.vault_policy_log('capture', p_version, 'rejected_version_exists', link || jsonb_build_object('sha256_now', cur_sha));
    return jsonb_build_object('ok', false, 'outcome', 'rejected_version_exists');
  end if;
  insert into public.vault_policy_backup (version, snapshot, snapshot_sha256) values (p_version, cur, cur_sha);
  perform public.vault_policy_log('capture', p_version, 'captured', link || jsonb_build_object('sha256', cur_sha));
  return jsonb_build_object('ok', true, 'outcome', 'captured', 'sha256', cur_sha);
end;
$$;

-- 사본 다시 읽어 검증(감사 한 줄). 결과에 사본 본문은 넣지 않습니다.
create or replace function public.vault_policy_verify(p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk jsonb := public.vault_policy_check_backup(p_version);
  result jsonb := chk - 'snapshot';
begin
  perform public.vault_policy_log('verify', p_version,
    case when (chk ->> 'ok')::boolean then 'verified' else 'stopped_' || (chk ->> 'reason') end, result);
  return result;
end;
$$;

-- 차이만 보기(읽기 전용, 아무것도 쓰지 않음): 버전과 바뀔 항목.
create or replace function public.vault_policy_diff(p_version text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  chk jsonb := public.vault_policy_check_backup(p_version);
  changes jsonb;
begin
  if not (chk ->> 'ok')::boolean then
    return chk;
  end if;
  changes := public.vault_policy_changes(public.vault_policy_current(), chk -> 'snapshot');
  return jsonb_build_object('ok', true, 'version', chk ->> 'version', 'captured_at', chk -> 'captured_at',
                            'sha256', chk ->> 'sha256', 'change_count', jsonb_array_length(changes), 'changes', changes);
end;
$$;

-- vault_notes의 정책·권한을 사본대로 맞춥니다(내부용, vault_policy_restore만 부름).
create or replace function public.vault_policy_apply(p_backup jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur jsonb := public.vault_policy_current();
  pol jsonb;
  bak jsonb;
  r text;
  priv text;
  role_sql text;
begin
  -- RLS 켜짐·강제
  if (p_backup ->> 'rls_enabled')::boolean then
    execute 'alter table public.vault_notes enable row level security';
  else
    execute 'alter table public.vault_notes disable row level security';
  end if;
  if (p_backup ->> 'rls_forced')::boolean then
    execute 'alter table public.vault_notes force row level security';
  else
    execute 'alter table public.vault_notes no force row level security';
  end if;
  -- 정책: 사본에 없거나 사본과 다른 정책은 지우고, 사본의 정책 중 지금과 다른 것만 다시 만듭니다.
  for pol in select * from jsonb_array_elements(cur -> 'policies') loop
    select e into bak from jsonb_array_elements(p_backup -> 'policies') e where e ->> 'name' = pol ->> 'name';
    if bak is null or bak <> pol then
      execute format('drop policy %I on public.vault_notes', pol ->> 'name');
    end if;
  end loop;
  for bak in select * from jsonb_array_elements(p_backup -> 'policies') loop
    select e into pol from jsonb_array_elements(cur -> 'policies') e where e ->> 'name' = bak ->> 'name';
    if pol is null or pol <> bak then
      execute format('create policy %I on public.vault_notes as %s for %s to %s%s%s',
        bak ->> 'name',
        case when (bak ->> 'permissive')::boolean then 'permissive' else 'restrictive' end,
        bak ->> 'command',
        (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
         from jsonb_array_elements_text(bak -> 'roles') x),
        case when bak ->> 'using' is null then '' else ' using (' || (bak ->> 'using') || ')' end,
        case when bak ->> 'with_check' is null then '' else ' with check (' || (bak ->> 'with_check') || ')' end);
    end if;
  end loop;
  -- 테이블 권한(역할별): 사본에 없는 권한은 거두고, 사본에 있는데 없는 권한은 줍니다.
  for r in select jsonb_object_keys(p_backup -> 'grants') loop
    role_sql := case when r = 'PUBLIC' then 'public' else quote_ident(r) end;
    for priv in select jsonb_array_elements_text(coalesce(cur -> 'grants' -> r, '[]'))
                except select jsonb_array_elements_text(p_backup -> 'grants' -> r) loop
      execute format('revoke %s on table public.vault_notes from %s', priv, role_sql);
    end loop;
    for priv in select jsonb_array_elements_text(p_backup -> 'grants' -> r)
                except select jsonb_array_elements_text(coalesce(cur -> 'grants' -> r, '[]')) loop
      execute format('grant %s on table public.vault_notes to %s', priv, role_sql);
    end loop;
  end loop;
  -- 칸 단위 권한(역할별, "권한:칸" 모양)
  for r in select jsonb_object_keys(p_backup -> 'column_grants') loop
    role_sql := case when r = 'PUBLIC' then 'public' else quote_ident(r) end;
    for priv in select jsonb_array_elements_text(coalesce(cur -> 'column_grants' -> r, '[]'))
                except select jsonb_array_elements_text(p_backup -> 'column_grants' -> r) loop
      execute format('revoke %s (%I) on table public.vault_notes from %s', split_part(priv, ':', 1), split_part(priv, ':', 2), role_sql);
    end loop;
    for priv in select jsonb_array_elements_text(p_backup -> 'column_grants' -> r)
                except select jsonb_array_elements_text(coalesce(cur -> 'column_grants' -> r, '[]')) loop
      execute format('grant %s (%I) on table public.vault_notes to %s', split_part(priv, ':', 1), split_part(priv, ':', 2), role_sql);
    end loop;
  end loop;
end;
$$;

-- 되돌리기. p_confirm false: 버전·바뀔 항목만(아무것도 안 바꿈). true: 사본을 다시 읽어 검증 → 정책·권한만 사본대로 →
-- 다시 읽어 대조, 다르면 예외로 바꾼 것을 전부 취소. 사본 없음·검증 실패면 아무것도 바꾸지 않고 멈춥니다. 모든 시도는 감사 한 줄.
create or replace function public.vault_policy_restore(p_version text, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_chk jsonb := public.vault_policy_check_backup(p_version);
  second_chk jsonb;
  changes jsonb;
  after_sha text;
  err text;
begin
  if not (first_chk ->> 'ok')::boolean then
    perform public.vault_policy_log(case when p_confirm then 'restore' else 'restore_preview' end, p_version,
      'stopped_' || (first_chk ->> 'reason'), first_chk - 'snapshot');
    return jsonb_build_object('ok', false, 'restored', false, 'reason', first_chk ->> 'reason', 'version', p_version);
  end if;
  changes := public.vault_policy_changes(public.vault_policy_current(), first_chk -> 'snapshot');
  if not p_confirm then
    perform public.vault_policy_log('restore_preview', p_version, 'preview',
      jsonb_build_object('change_count', jsonb_array_length(changes),
                         'items', (select coalesce(jsonb_agg(c ->> 'item'), '[]'::jsonb) from jsonb_array_elements(changes) c)));
    return jsonb_build_object('ok', true, 'preview', true, 'restored', false, 'version', p_version,
                              'captured_at', first_chk -> 'captured_at', 'sha256', first_chk ->> 'sha256',
                              'change_count', jsonb_array_length(changes), 'changes', changes);
  end if;
  -- 쓰기 직전에 사본을 한 번 더 읽어 검증하고, 처음 읽은 것과 같은지 봅니다.
  second_chk := public.vault_policy_check_backup(p_version);
  if not (second_chk ->> 'ok')::boolean or second_chk ->> 'sha256' <> first_chk ->> 'sha256' then
    perform public.vault_policy_log('restore', p_version, 'stopped_backup_changed', second_chk - 'snapshot');
    return jsonb_build_object('ok', false, 'restored', false, 'reason', 'backup_changed', 'version', p_version);
  end if;
  if jsonb_array_length(changes) = 0 then
    perform public.vault_policy_log('restore', p_version, 'nothing_to_restore', jsonb_build_object('sha256', second_chk ->> 'sha256'));
    return jsonb_build_object('ok', true, 'restored', false, 'version', p_version, 'change_count', 0, 'matched', true);
  end if;
  begin
    perform public.vault_policy_apply(second_chk -> 'snapshot');
    after_sha := public.vault_policy_sha256(public.vault_policy_current());
    if after_sha <> second_chk ->> 'sha256' then
      raise exception 'restore_mismatch';
    end if;
  exception when others then
    -- 이 블록 안에서 바꾼 정책·권한은 모두 취소됩니다. 감사 기록만 남깁니다.
    err := sqlerrm;
    perform public.vault_policy_log('restore', p_version, 'rolled_back',
      jsonb_build_object('error', left(err, 200), 'change_count', jsonb_array_length(changes)));
    return jsonb_build_object('ok', false, 'restored', false, 'reason', 'rolled_back', 'version', p_version);
  end;
  perform public.vault_policy_log('restore', p_version, 'restored',
    jsonb_build_object('sha256', after_sha, 'change_count', jsonb_array_length(changes),
                       'items', (select jsonb_agg(c ->> 'item') from jsonb_array_elements(changes) c)));
  return jsonb_build_object('ok', true, 'restored', true, 'matched', true, 'version', p_version, 'sha256', after_sha,
                            'change_count', jsonb_array_length(changes), 'changes', changes);
end;
$$;

-- 함수 실행 권한은 모두 거둡니다(Data API RPC로 부를 수 없음, SQL Editor에서만).
revoke all on function public.vault_policy_block_change() from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_current() from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_problems(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_changes(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_log(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_check_backup(text) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_capture(text, integer) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_verify(text) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_diff(text) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_apply(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vault_policy_restore(text, boolean) from public, anon, authenticated, service_role;

commit;

-- ===================== 침해 전 사본 남기기 =====================
-- 's9-safe-1': 판정기 정책 버전 1(policyRevision 1)과 짝인 DB 안전 정책. 안전 기준과 다르면 남기지 않고 거부(감사 기록에 남음).
select public.vault_policy_capture('s9-safe-1', 1);

-- ===================== 결과 (select 하나의 표) =====================
-- SQL Editor는 마지막 결과 표만 보여 줍니다. 항목 이름의 괄호 안이 기대값입니다. 메모 내용은 읽지 않습니다.
with verify as materialized (select public.vault_policy_verify('s9-safe-1') as v),
     diff as materialized (select public.vault_policy_diff('s9-safe-1') as d),
     last_capture as (select outcome, detail from public.vault_policy_audit
                      where action = 'capture' and version = 's9-safe-1' order by audit_id desc limit 1)
select "항목", "값" from (
  select 1 as ord, '1 사본 남기기 결과 (기대: captured 또는 already_captured_same)' as "항목",
         (select outcome from last_capture) as "값"
  union all
  select 2, '2 안전 기준과 다른 점 (기대: [])',
         coalesce((select detail ->> 'problems' from last_capture), '[]')
  union all
  select 3, '3 사본 다시 읽어 해시 재계산 (기대: true)', (select v ->> 'ok' from verify)
  union all
  select 4, '4 사본 sha256 앞 12자', (select left(v ->> 'sha256', 12) from verify)
  union all
  select 5, '5 지금과 사본의 바뀔 항목 수 (기대: 0)', (select d ->> 'change_count' from diff)
  union all
  select 6, '6 사본 수 / 감사 줄 수', (select count(*) from public.vault_policy_backup)::text || ' / '
                                        || (select count(*) from public.vault_policy_audit)::text
  union all
  select 7, '7 RLS 켜짐 vault_policy_backup·vault_policy_audit (기대: true, true)',
         (select string_agg(relrowsecurity::text, ', ' order by relname) from pg_class
          where oid in ('public.vault_policy_audit'::regclass, 'public.vault_policy_backup'::regclass))
  union all
  select 8, '8 두 표의 PUBLIC·anon·authenticated·service_role 권한 (기대: 없음)',
         coalesce((select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ')
                   from information_schema.role_table_grants
                   where table_schema = 'public' and table_name in ('vault_policy_backup', 'vault_policy_audit')
                     and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')), '없음')
  union all
  select 9, '9 수정·삭제 막는 트리거 수 (기대: 4)',
         (select count(*)::text from pg_trigger
          where tgrelid in ('public.vault_policy_backup'::regclass, 'public.vault_policy_audit'::regclass) and not tgisinternal)
  union all
  select 10, '10 함수 실행 권한 anon·authenticated·service_role (기대: 모두 false)',
         (select string_agg(x.role || ' ' || x.can::text, ', ' order by x.role)
          from (select r.role, bool_or(has_function_privilege(r.role, p.oid, 'EXECUTE')) as can
                from (values ('anon'), ('authenticated'), ('service_role')) r(role)
                cross join pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.proname like 'vault\_policy\_%'
                group by r.role) x)
  union all
  select 11, '11 vault_notes RLS 켜짐 / 정책 수 (기대: true / 4)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass) || ' / '
         || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'vault_notes')
) as checks
order by ord;
