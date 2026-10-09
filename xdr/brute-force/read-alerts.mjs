// brute-force 경보를 사람이 확인하려고 읽는 모듈입니다. decide.mjs 는 이 파일을 불러오지 않습니다.
// 원본 경보는 읽기만 하고, 시각·출발 주소·계정·규칙 수준·설명 다섯 항목만 꺼냅니다.
// 그 밖의 칸은 꺼내지 않고, 다섯 항목 안에서도 비밀값처럼 보이는 문자열은 가려서 보여 줍니다.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = '[가림]';
const SECRET_PATTERNS = [
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)\s*[:=]\s*\S+/gi,
  /\bBearer\s+\S+/gi,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT
  /\bsb_(?:secret|publishable)_\w+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9+/_-]{32,}={0,2}/g, // 긴 무작위 문자열
];

export function maskSecrets(value) {
  if (typeof value !== 'string') return null;
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, MASK), value);
}

export function readAlert(alert) {
  return {
    id: maskSecrets(alert?.id),
    timestamp: maskSecrets(alert?.timestamp),
    srcip: maskSecrets(alert?.data?.srcip),
    srcuser: maskSecrets(alert?.data?.srcuser),
    level: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: maskSecrets(alert?.rule?.description),
  };
}

export async function readAlerts(root) {
  const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'brute-force.json'), 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'brute-force' || !Array.isArray(fixture.alerts)) {
    throw new Error('brute-force 경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(readAlert);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const rows = await readAlerts(root);
  console.table(rows);
  console.log(`경보 ${rows.length}건 (확인용 출력이며 판정 결과가 아닙니다)`);
}
