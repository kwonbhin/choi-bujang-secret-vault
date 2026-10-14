-- 10단계: DB 안전 정책 복원 시험. 학생 설계(계약에 없음).
-- supabase/step10_policy_backup.sql을 실행해 사본 's9-safe-1'이 남은 뒤, 학생이 SQL Editor에서 직접 실행합니다.
-- 키·비밀번호·메모 내용·이메일은 다루지 않습니다. 메모는 개수만 셉니다. 여러 번 실행해도 됩니다.
--
-- 하는 일(DO 블록 하나 = 한 트랜잭션):
--   1. 침공 흉내: vault_notes에 "모두 읽기" 정책 추가, 본인 수정 정책(vault_notes_update_own) 삭제, authenticated에 SELECT 권한 부여
--   2. 미리보기: vault_policy_restore('s9-safe-1', false) — 바뀔 항목만 보고 아무것도 안 바꿈
--   3. 복원:     vault_policy_restore('s9-safe-1', true)
--   4. 확인: 지금 정책이 사본과 같음(sha256), authenticated 직접 읽기는 권한 없음으로 거부,
--            RLS 확인용으로 SELECT를 잠깐 준 상태(곧바로 취소)에서 B가 A 메모 읽기 0건·A가 자기 메모 1건 이상
--   5. 결과를 vault_policy_audit에 'restore_test' pass/fail 한 줄로 남깁니다.
--      실패하면 1~4에서 바꾼 것(침공 흉내·복원·그 감사 줄)을 전부 취소하고 fail 줄만 남깁니다.
-- A·B: 실제 계정 이름을 쓰지 않고, 메모 주인 중 가장 먼저 메모를 만든 주인을 A, 두 번째를 B로 봅니다(id는 출력하지 않음).
-- 다른 표의 정책·사본·감사 기록은 건드리지 않습니다.

create temp table if not exists step10_restore_test_result (ord int, "항목" text, "값" text);
truncate step10_restore_test_result;

do $$
declare
  owner_a uuid;
  owner_b uuid;
  v_preview jsonb;
  v_restore jsonb;
  backup_sha text;
  now_sha text;
  breached boolean := false;
  same_as_backup boolean := false;
  direct_denied boolean := null;
  b_reads_a bigint := null;
  a_reads_a bigint := null;
  probe_error text := null;
  result text := 'fail';
  reason text := null;
begin
  select owner_id into owner_a from (
    select owner_id, min(created_at) as first_at from public.vault_notes where owner_id is not null
    group by owner_id order by first_at, owner_id limit 1) x;
  select owner_id into owner_b from (
    select owner_id, min(created_at) as first_at from public.vault_notes where owner_id is not null
    group by owner_id order by first_at, owner_id offset 1 limit 1) x;

  begin
    if owner_a is null or owner_b is null then
      raise exception 'need_two_owners' using errcode = 'U0001';
    end if;
    if not (public.vault_policy_check_backup('s9-safe-1') ->> 'ok')::boolean then
      raise exception 'backup_not_verified' using errcode = 'U0001';
    end if;
    backup_sha := public.vault_policy_check_backup('s9-safe-1') ->> 'sha256';

    -- 1. 침공 흉내
    execute 'create policy vault_notes_breach_read_all on public.vault_notes for select to authenticated using (true)';
    execute 'drop policy if exists vault_notes_update_own on public.vault_notes';
    execute 'grant select on table public.vault_notes to authenticated';
    breached := public.vault_policy_sha256(public.vault_policy_current()) <> backup_sha;

    -- 2. 미리보기(아무것도 안 바꿈)
    v_preview := public.vault_policy_restore('s9-safe-1', false);
    if public.vault_policy_sha256(public.vault_policy_current()) = backup_sha then
      raise exception 'preview_changed_policy' using errcode = 'U0001';
    end if;

    -- 3. 복원
    v_restore := public.vault_policy_restore('s9-safe-1', true);

    -- 4-1. 사본과 같은지
    now_sha := public.vault_policy_sha256(public.vault_policy_current());
    same_as_backup := now_sha = backup_sha;

    -- 4-2. authenticated 직접 읽기: 안전 기준에서는 테이블 권한이 없어 거부되어야 합니다.
    begin
      perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_b, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform count(*) from public.vault_notes;
      direct_denied := false;
      execute 'reset role';
    exception when insufficient_privilege then
      direct_denied := true;
    end;

    -- 4-3. RLS 확인: SELECT를 잠깐 주고 B·A로 세어 본 뒤, 일부러 오류를 내 그 권한까지 취소합니다(센 값만 남음).
    begin
      execute 'grant select on table public.vault_notes to authenticated';
      perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_b, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into b_reads_a from public.vault_notes where owner_id = owner_a;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
      select count(*) into a_reads_a from public.vault_notes where owner_id = owner_a;
      execute 'reset role';
      raise exception 'probe_rollback' using errcode = 'U0009';
    exception
      when sqlstate 'U0009' then null;
      when others then probe_error := left(sqlerrm, 120);
    end;

    if not (breached and (v_preview ->> 'ok')::boolean and (v_preview ->> 'change_count')::int > 0
            and (v_restore ->> 'restored')::boolean and same_as_backup and direct_denied
            and b_reads_a = 0 and a_reads_a > 0 and probe_error is null) then
      raise exception 'check_failed' using errcode = 'U0001';
    end if;
    result := 'pass';
  exception when others then
    -- 1~4에서 바꾼 것은 이 블록과 함께 모두 취소됩니다(변수에 담은 값은 남음).
    result := 'fail';
    reason := left(sqlerrm, 120);
  end;

  perform public.vault_policy_log('restore_test', 's9-safe-1', result, jsonb_build_object(
    'reason', reason, 'breached', breached,
    'preview_change_count', v_preview -> 'change_count', 'restored', v_restore -> 'restored',
    'same_as_backup', same_as_backup, 'direct_denied', direct_denied,
    'b_reads_a', b_reads_a, 'a_reads_a', a_reads_a, 'probe_error', probe_error));

  insert into step10_restore_test_result values
    (1, '1 시험 결과 (기대: pass)', result || coalesce(' · ' || reason, '')),
    (2, '2 침공 흉내 뒤 사본과 달라짐 (기대: true)', coalesce(breached::text, 'null')),
    (3, '3 미리보기 바뀔 항목 수 (기대: 1 이상) / 항목',
        coalesce(v_preview ->> 'change_count', 'null') || ' / '
        || coalesce((select string_agg(c ->> 'item', ', ') from jsonb_array_elements(v_preview -> 'changes') c), '')),
    (4, '4 복원 결과 restored (기대: true)', coalesce(v_restore ->> 'restored', 'null') || coalesce(' · ' || (v_restore ->> 'reason'), '')),
    (5, '5 복원 뒤 사본과 같음 (기대: true)', same_as_backup::text),
    (6, '6 authenticated 직접 읽기 권한 없음으로 거부 (기대: true)', coalesce(direct_denied::text, 'null')),
    (7, '7 B가 A 메모 읽기 건수 (기대: 0)', coalesce(b_reads_a::text, 'null')),
    (8, '8 A가 자기 메모 읽기 건수 (기대: 1 이상)', coalesce(a_reads_a::text, 'null')),
    (9, '9 RLS 확인 오류 (기대: 없음)', coalesce(probe_error, '없음'));
end;
$$;

-- 결과 (select 하나의 표). 마지막 줄들은 시험 뒤 지금 상태입니다.
select "항목", "값" from (
  select ord, "항목", "값" from step10_restore_test_result
  union all
  select 10, '10 지금 vault_notes 정책 (기대: 본인 행 정책 4개)',
         (select count(*)::text || '개: ' || string_agg(policyname, ', ' order by policyname)
          from pg_policies where schemaname = 'public' and tablename = 'vault_notes')
  union all
  select 11, '11 지금 anon·authenticated·PUBLIC 테이블 권한 (기대: 없음)',
         coalesce((select string_agg(grantee || ':' || privilege_type, ', ')
                   from information_schema.role_table_grants
                   where table_schema = 'public' and table_name = 'vault_notes'
                     and grantee in ('PUBLIC', 'anon', 'authenticated')), '없음')
  union all
  select 12, '12 마지막 감사 줄 (기대: restore_test pass)',
         (select action || ' ' || outcome from public.vault_policy_audit order by audit_id desc limit 1)
) as checks
order by ord;
