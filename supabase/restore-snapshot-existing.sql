-- 10단계: 지금 있는 메모를 한 번 사본으로 뜹니다. 학생 설계(계약에 없음).
-- supabase/restore.sql을 실행한 뒤 SQL Editor에서 실행합니다. 여러 번 실행해도 됩니다.
-- 이미 사본이 있는 id는 건드리지 않습니다(ON CONFLICT DO NOTHING). 처음 뜬 사본이 계속 기준입니다.
-- 주의: 이미 변조된 메모가 있다면 변조된 내용이 사본이 됩니다. 실행 전에 메모가 정상인지 화면에서 확인하세요.

begin;

insert into public.vault_notes_snapshot (id, owner_id, title, content, created_at, content_sha256)
select id, owner_id, title, content, created_at, public.vault_note_sha256(title, content)
from public.vault_notes
on conflict (id) do nothing;

commit;

-- 확인(읽기 전용). SQL Editor는 마지막 결과 표만 보여 주므로 select 한 번에 (항목, 값) 표로 모았습니다.
-- 항목 이름의 괄호 안이 기대값입니다. 메모 내용은 보지 않고 개수만 셉니다.
select "항목", "값"
from (
  select 1 as ord, '1 메모 수' as "항목", (select count(*)::text from public.vault_notes) as "값"
  union all
  select 2, '2 사본 수 (기대: 메모 수 이상)', (select count(*)::text from public.vault_notes_snapshot)
  union all
  select 3, '3 사본이 없는 메모 수 (기대: 0)',
         (select count(*)::text from public.vault_notes n
          where not exists (select 1 from public.vault_notes_snapshot s where s.id = n.id))
  union all
  select 4, '4 사본 뒤 내용이 바뀐 메모 수 (기대: 0)',
         (select count(*)::text from public.vault_notes n join public.vault_notes_snapshot s on s.id = n.id
          where public.vault_note_sha256(n.title, n.content) <> s.content_sha256)
  union all
  select 5, '5 사본 주인과 메모 주인이 다른 수 (기대: 0)',
         (select count(*)::text from public.vault_notes n join public.vault_notes_snapshot s on s.id = n.id
          where n.owner_id is distinct from s.owner_id)
) as checks
order by ord;
