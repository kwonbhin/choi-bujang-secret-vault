// 9단계 탐지 함수입니다. 계약은 docs/DETECT_EVENTS.md 입니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
// 사건에서는 계약의 at, method, identity.sub 세 값만 읽습니다. 그 밖의 값(메모 내용·토큰·실명 등)은
// 읽지도 저장하지도 출력하지도 않습니다. 회수는 제안만 돌려주고 집행하지 않습니다.
const WINDOW_MS = 10 * 60 * 1000; // 어느 10분 구간
const BURST_LIMIT = 120; // 이 건수를 넘을 때만 회수 제안 (정확히 120건은 제안하지 않음)

// 사건 하나에서 계약의 세 값만 꺼냅니다. 형식이 틀린 사건은 세지 않습니다.
function readEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return null;
  const { at, method, identity } = event;
  const time = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  const sub = identity !== null && typeof identity === 'object' ? identity.sub : undefined;
  if (!Number.isFinite(time) || typeof method !== 'string' || typeof sub !== 'string' || !sub) return null;
  return { time, method, sub };
}

export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  // 같은 sub의 GET 사건 시각만 모읍니다. 다른 사용자의 사건은 합산하지 않습니다.
  const timesBySub = new Map();
  for (const raw of events) {
    const event = readEvent(raw);
    if (!event || event.method !== 'GET') continue;
    const times = timesBySub.get(event.sub) ?? [];
    times.push(event.time);
    timesBySub.set(event.sub, times);
  }

  // 어느 10분 구간에서든 120건을 넘는 sub가 있으면 가장 먼저 넘은 sub 하나를 제안합니다.
  let found = null;
  for (const [sub, times] of timesBySub) {
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] >= WINDOW_MS) start += 1;
      if (end - start + 1 > BURST_LIMIT) {
        if (!found || times[end] < found.time) found = { sub, time: times[end] };
        break;
      }
    }
  }
  if (!found) return { action: 'observe' };
  return { action: 'propose_revocation', reasonCode: 'burst_read', subject: found.sub };
}
