-- 11단계: 기기 등록부(vault_devices)와 서버가 낸 일회용 질문(vault_device_challenges). 학생 설계(계약에 없음).
-- 학생이 Supabase 대시보드 > SQL Editor에서 직접 실행합니다. 키·비밀번호·메모 내용·이메일은 필요 없고 저장하지 않습니다.
-- 여러 번 실행해도 됩니다(표·트리거는 있으면 그대로 두거나 같은 내용으로 다시 만듭니다. 기기 행은 지우지 않습니다).
--
-- 실행 순서
--   1. 이 파일                     등록부·질문 표, 권한, 트리거, 마지막에 확인 표
--   2. 코드 배포(커밋 「11단계 저장점」) 뒤 화면에서 「이 기기 승인 요청」 → 등록부에 pending 행이 생깁니다.
--   3. 이 파일 맨 아래 [목록] → [승인] SQL을 SQL Editor에서 직접 실행합니다. 승인은 앱 API에 경로가 없습니다.
--   4. 화면에서 「승인 상태 다시 확인」 → 승인됨이면 메모가 보입니다.
--
-- 저장하는 것: 기기 공개키(패스키 공개키, SPKI DER base64url)와 서명 방식 번호, 상태, 만든 시각.
--   개인키는 기기 인증 장치 밖으로 나오지 않아 여기에 없습니다. 질문은 원문 대신 SHA-256 해시만 저장합니다.
-- 이 파일은 vault_notes·사본·봉인·감사 기록·다른 정책을 바꾸지 않습니다.

begin;

create table if not exists public.vault_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_id text not null unique check (credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 16 and 1400),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]+$' and length(public_key) between 40 and 1200),
  alg integer not null check (alg in (-7, -257)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  status_changed_at timestamptz
);
create index if not exists vault_devices_owner_idx on public.vault_devices (owner_id);

create table if not exists public.vault_device_challenges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  purpose text not null check (purpose in ('register', 'verify')),
  challenge_sha256 text not null unique check (challenge_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vault_device_challenges_owner_idx on public.vault_device_challenges (owner_id, created_at);

-- RLS를 켜고(정책 없음) PUBLIC·anon·authenticated 권한을 모두 거둡니다.
-- service_role(서버 함수)에는 필요한 것만 줍니다.
--   vault_devices: select·insert만(상태를 바꾸는 update는 주지 않음 → 승인·취소는 SQL Editor에서만)
--   vault_device_challenges: select·insert와 used_at 칸 update만(질문을 한 번 썼다고 표시)
alter table public.vault_devices enable row level security;
alter table public.vault_device_challenges enable row level security;
revoke all on table public.vault_devices from public, anon, authenticated, service_role;
revoke all on table public.vault_device_challenges from public, anon, authenticated, service_role;
grant select, insert on table public.vault_devices to service_role;
grant select, insert on table public.vault_device_challenges to service_role;
grant update (used_at) on table public.vault_device_challenges to service_role;

-- 새 기기는 본문에 무엇이 오든 항상 pending으로 만듭니다. 한 사용자의 pending 기기는 3개까지입니다.
create or replace function public.vault_devices_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'pending';
  new.created_at := now();
  new.status_changed_at := null;
  if (select count(*) from public.vault_devices d where d.owner_id = new.owner_id and d.status = 'pending') >= 3 then
    raise exception 'pending 기기가 너무 많습니다.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- 상태 말고는 바꿀 수 없습니다. 상태는 pending→approved, pending→revoked, approved→revoked만 됩니다.
create or replace function public.vault_devices_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id or new.credential_id <> old.credential_id
     or new.public_key <> old.public_key or new.alg <> old.alg or new.created_at <> old.created_at then
    raise exception 'vault_devices는 상태만 바꿀 수 있습니다.' using errcode = '42501';
  end if;
  if new.status <> old.status then
    if not ((old.status = 'pending' and new.status in ('approved', 'revoked'))
            or (old.status = 'approved' and new.status = 'revoked')) then
      raise exception 'vault_devices 상태는 % → %로 바꿀 수 없습니다.', old.status, new.status using errcode = '42501';
    end if;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

-- 질문은 used_at만 한 번 채울 수 있습니다. 한 사용자의 쓰지 않은 유효한 질문은 10개까지입니다.
create or replace function public.vault_device_challenges_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.used_at := null;
  new.created_at := now();
  if new.expires_at > now() + interval '5 minutes' then
    raise exception '질문 만료 시각이 너무 깁니다.' using errcode = '22023';
  end if;
  if (select count(*) from public.vault_device_challenges c
      where c.owner_id = new.owner_id and c.used_at is null and c.expires_at > now()) >= 10 then
    raise exception '열린 질문이 너무 많습니다.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.vault_device_challenges_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.used_at is not null or new.used_at is null or new.id <> old.id or new.owner_id <> old.owner_id
     or new.purpose <> old.purpose or new.challenge_sha256 <> old.challenge_sha256
     or new.expires_at <> old.expires_at or new.created_at <> old.created_at then
    raise exception '질문은 한 번만 쓸 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.vault_devices_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.vault_devices_before_update() from public, anon, authenticated, service_role;
revoke all on function public.vault_device_challenges_before_insert() from public, anon, authenticated, service_role;
revoke all on function public.vault_device_challenges_before_update() from public, anon, authenticated, service_role;

drop trigger if exists vault_devices_insert on public.vault_devices;
create trigger vault_devices_insert before insert on public.vault_devices
  for each row execute function public.vault_devices_before_insert();
drop trigger if exists vault_devices_update on public.vault_devices;
create trigger vault_devices_update before update on public.vault_devices
  for each row execute function public.vault_devices_before_update();
drop trigger if exists vault_device_challenges_insert on public.vault_device_challenges;
create trigger vault_device_challenges_insert before insert on public.vault_device_challenges
  for each row execute function public.vault_device_challenges_before_insert();
drop trigger if exists vault_device_challenges_update on public.vault_device_challenges;
create trigger vault_device_challenges_update before update on public.vault_device_challenges
  for each row execute function public.vault_device_challenges_before_update();

commit;

-- 확인(읽기 전용, select 하나의 표). 항목 이름의 괄호 안이 기대값입니다. 공개키·질문 해시는 읽지 않습니다.
select "항목", "값" from (
  select 1 as ord, r.ord as sub, '1 기기 표 권한 ' || r.grantee || r.expected as "항목",
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_devices' and g.grantee = r.grantee), '없음') as "값"
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: INSERT, SELECT)')) as r(ord, grantee, expected)
  union all
  select 2, r.ord, '2 질문 표 권한 ' || r.grantee || r.expected,
         coalesce((select string_agg(g.privilege_type, ', ' order by g.privilege_type)
                   from information_schema.role_table_grants g
                   where g.table_schema = 'public' and g.table_name = 'vault_device_challenges' and g.grantee = r.grantee), '없음')
         || coalesce(' / 칸 UPDATE: ' || (select string_agg(c.column_name, ', ' order by c.column_name)
                   from information_schema.column_privileges c
                   where c.table_schema = 'public' and c.table_name = 'vault_device_challenges' and c.grantee = r.grantee
                     and c.privilege_type = 'UPDATE'), '')
  from (values (1, 'PUBLIC', ' (기대: 없음)'), (2, 'anon', ' (기대: 없음)'), (3, 'authenticated', ' (기대: 없음)'),
               (4, 'service_role', ' (기대: INSERT, SELECT / 칸 UPDATE: used_at)')) as r(ord, grantee, expected)
  union all
  select 3, 1, '3 RLS 켜짐 기기 / 질문 (기대: true / true)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_devices'::regclass) || ' / '
         || (select relrowsecurity::text from pg_class where oid = 'public.vault_device_challenges'::regclass)
  union all
  select 4, 1, '4 트리거 (기대: 4개)',
         (select count(*)::text || '개: ' || string_agg(tgname, ', ' order by tgname) from pg_trigger
          where tgrelid in ('public.vault_devices'::regclass, 'public.vault_device_challenges'::regclass) and not tgisinternal)
  union all
  select 5, 1, '5 트리거 함수 실행 권한 anon·authenticated·service_role (기대: 모두 false)',
         (select string_agg(f.fn || ' ' || r.role || ' '
                 || has_function_privilege(r.role, 'public.' || f.fn || '()', 'EXECUTE')::text, ', ' order by f.fn, r.role)
          from (values ('vault_devices_before_insert'), ('vault_devices_before_update'),
                       ('vault_device_challenges_before_insert'), ('vault_device_challenges_before_update')) f(fn),
               (values ('anon'), ('authenticated'), ('service_role')) r(role))
  union all
  select 6, 1, '6 기기 수 pending / approved / revoked',
         (select count(*) filter (where status = 'pending')::text || ' / '
                 || count(*) filter (where status = 'approved')::text || ' / '
                 || count(*) filter (where status = 'revoked')::text from public.vault_devices)
  union all
  select 7, 1, '7 vault_notes RLS 켜짐 / 정책 수 (기대: true / 4, 바뀌지 않음)',
         (select relrowsecurity::text from pg_class where oid = 'public.vault_notes'::regclass) || ' / '
         || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'vault_notes')
) as checks
order by ord, sub;

-- ─────────────────────────────────────────────────────────────────────────────
-- 학생이 SQL Editor에서 직접 하는 기기 승인 (이 앱에는 승인·취소 API가 없습니다)
-- 아래 줄의 맨 앞 "-- "를 지우고 한 덩어리씩 실행합니다. <기기 id>는 [목록]에서 본 id로 바꿉니다.
-- 승인하기 전에 [목록]의 만든 시각·계정이 방금 화면에서 「이 기기 승인 요청」을 누른 것과 같은지 확인합니다.
--
-- [목록] 기기 id·계정·상태·만든 시각(공개키는 보이지 않음)
-- select d.id, u.email, d.status, d.created_at, d.status_changed_at
-- from public.vault_devices d left join auth.users u on u.id = d.owner_id
-- order by d.created_at desc limit 20;
--
-- [승인] pending 기기 하나를 승인합니다(pending이 아니면 0행).
-- update public.vault_devices set status = 'approved'
-- where id = '<기기 id>' and status = 'pending'
-- returning id, status, status_changed_at;
--
-- [취소] 승인된 기기나 대기 중인 기기를 취소합니다. 취소한 기기는 다시 승인할 수 없고, 새로 승인 요청을 해야 합니다.
-- 취소하면 그 기기의 30분 기기 확인 결과도 다음 자료 요청부터 거부됩니다(자료 API가 등록부를 다시 읽음).
-- update public.vault_devices set status = 'revoked'
-- where id = '<기기 id>' and status in ('pending', 'approved')
-- returning id, status, status_changed_at;
--
-- [정리] 만료됐거나 쓴 질문 지우기(선택)
-- delete from public.vault_device_challenges where expires_at < now() - interval '1 day';
