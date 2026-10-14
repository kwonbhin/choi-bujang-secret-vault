// 11단계: 웹 표준 패스키(WebAuthn) 응답을 서버에서 검사합니다. 새 패키지 없이 Node 내장 crypto만 씁니다.
// - 등록: clientDataJSON(type webauthn.create·질문·출처)과 attestationObject 안의 authenticatorData(rpId 해시·
//   사용자 확인 표시·자격 증명 id)를 검사하고, 그 안의 COSE 공개키를 SPKI(DER, base64url)로 바꿔 돌려줍니다.
//   attestation은 'none'으로 받고 제조사 증명은 검사하지 않습니다. 그래서 이 키가 기기 인증 장치 안의 키라는 것은
//   서버가 증명하지 못하고, 학생이 SQL Editor에서 승인하는 단계가 그 확인을 맡습니다.
// - 확인: clientDataJSON(type webauthn.get·질문·출처), authenticatorData(rpId 해시·사용자 확인 표시),
//   서명(authenticatorData || SHA-256(clientDataJSON))을 등록부의 공개키로 검증합니다.
// 개인키는 서버로 오지 않습니다. 공개키·서명·질문은 로그에 남기지 않습니다.
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const MAX_CBOR_DEPTH = 8;

export class WebAuthnError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = code => { throw new WebAuthnError(code); };

const B64URL = /^[A-Za-z0-9_-]+$/u;
export function fromB64url(value, { max = 16384, code = 'WEBAUTHN_FORMAT' } = {}) {
  if (typeof value !== 'string' || !value || value.length > max || !B64URL.test(value)) fail(code);
  return Buffer.from(value, 'base64url');
}
export const sha256 = data => createHash('sha256').update(data).digest();

// CBOR(RFC 8949)에서 패스키 응답에 필요한 부분만 읽습니다. 길이를 모르는 항목·태그·실수는 받지 않습니다.
export function decodeCbor(bytes, start = 0) {
  let pos = start;
  const need = n => { if (pos + n > bytes.length) fail('WEBAUTHN_FORMAT'); };
  const length = info => {
    if (info < 24) return info;
    if (info === 24) { need(1); return bytes[pos++]; }
    if (info === 25) { need(2); const v = bytes.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = bytes.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) {
      need(8);
      const v = bytes.readBigUInt64BE(pos);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) fail('WEBAUTHN_FORMAT');
      return Number(v);
    }
    return fail('WEBAUTHN_FORMAT');
  };
  const item = depth => {
    if (depth > MAX_CBOR_DEPTH) fail('WEBAUTHN_FORMAT');
    need(1);
    const head = bytes[pos++];
    const major = head >> 5;
    const info = head & 0x1f;
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      return fail('WEBAUTHN_FORMAT');
    }
    const n = length(info);
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { need(n); const v = bytes.subarray(pos, pos + n); pos += n; return Buffer.from(v); }
      case 3: { need(n); const v = bytes.toString('utf8', pos, pos + n); pos += n; return v; }
      case 4: { const out = []; for (let i = 0; i < n; i += 1) out.push(item(depth + 1)); return out; }
      case 5: {
        const out = new Map();
        for (let i = 0; i < n; i += 1) {
          const key = item(depth + 1);
          if (typeof key !== 'number' && typeof key !== 'string') fail('WEBAUTHN_FORMAT');
          if (out.has(key)) fail('WEBAUTHN_FORMAT');
          out.set(key, item(depth + 1));
        }
        return out;
      }
      default: return fail('WEBAUTHN_FORMAT');
    }
  };
  const value = item(0);
  return { value, end: pos };
}

// authenticatorData: rpIdHash(32) | flags(1) | signCount(4) | [aaguid(16) | idLen(2) | credentialId | COSE 공개키]
export function parseAuthData(authData) {
  if (!Buffer.isBuffer(authData) || authData.length < 37) fail('WEBAUTHN_FORMAT');
  const out = {
    rpIdHash: authData.subarray(0, 32),
    flags: authData[32],
    signCount: authData.readUInt32BE(33),
    credentialId: null,
    coseKey: null,
  };
  if (out.flags & FLAG_AT) {
    if (authData.length < 55) fail('WEBAUTHN_FORMAT');
    const idLength = authData.readUInt16BE(53);
    if (idLength < 16 || idLength > 1023 || authData.length < 55 + idLength + 1) fail('WEBAUTHN_FORMAT');
    out.credentialId = Buffer.from(authData.subarray(55, 55 + idLength));
    const { value } = decodeCbor(authData, 55 + idLength);
    if (!(value instanceof Map)) fail('WEBAUTHN_FORMAT');
    out.coseKey = value;
  }
  return out;
}

// COSE 공개키(ES256 P-256, RS256 2048비트 이상)만 받아 Node 공개키로 바꿉니다.
export function coseToPublicKey(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  let jwk;
  if (alg === ALG_ES256 && kty === 2) {
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (cose.get(-1) !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) {
      fail('WEBAUTHN_KEY_UNSUPPORTED');
    }
    jwk = { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') };
  } else if (alg === ALG_RS256 && kty === 3) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 512 || e.length > 8) {
      fail('WEBAUTHN_KEY_UNSUPPORTED');
    }
    jwk = { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') };
  } else {
    fail('WEBAUTHN_KEY_UNSUPPORTED');
  }
  let key;
  try { key = createPublicKey({ key: jwk, format: 'jwk' }); } catch { fail('WEBAUTHN_KEY_UNSUPPORTED'); }
  return { alg, publicKey: key.export({ type: 'spki', format: 'der' }).toString('base64url') };
}

// clientDataJSON을 읽어 종류·출처를 확인하고, 질문(challenge, base64url)을 돌려줍니다.
export function readClientData(clientDataJSON, { type, origin }) {
  let data;
  try { data = JSON.parse(clientDataJSON.toString('utf8')); } catch { fail('WEBAUTHN_FORMAT'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('WEBAUTHN_FORMAT');
  if (data.type !== type) fail('WEBAUTHN_TYPE');
  if (data.origin !== origin) fail('WEBAUTHN_ORIGIN');
  if (data.crossOrigin === true) fail('WEBAUTHN_ORIGIN');
  if (typeof data.challenge !== 'string' || !B64URL.test(data.challenge) || data.challenge.length > 128) {
    fail('WEBAUTHN_FORMAT');
  }
  return data.challenge;
}

function checkFlags(parsed, rpId) {
  if (!parsed.rpIdHash.equals(sha256(Buffer.from(rpId, 'utf8')))) fail('WEBAUTHN_RP');
  if (!(parsed.flags & FLAG_UP)) fail('WEBAUTHN_USER_PRESENCE');
  if (!(parsed.flags & FLAG_UV)) fail('WEBAUTHN_USER_VERIFICATION');
}

// 등록 응답 검사. 반환: { challenge, credentialId(base64url), publicKey(SPKI base64url), alg }
export function verifyRegistration({ credentialId, clientDataJSON, attestationObject }, { rpId, origin }) {
  const rawId = fromB64url(credentialId, { max: 1400 });
  const clientData = fromB64url(clientDataJSON, { max: 4096 });
  const attestation = fromB64url(attestationObject, { max: 16384 });
  const challenge = readClientData(clientData, { type: 'webauthn.create', origin });
  const { value } = decodeCbor(attestation);
  if (!(value instanceof Map) || typeof value.get('fmt') !== 'string' || !Buffer.isBuffer(value.get('authData'))) {
    fail('WEBAUTHN_FORMAT');
  }
  const parsed = parseAuthData(value.get('authData'));
  checkFlags(parsed, rpId);
  if (!parsed.credentialId || !parsed.coseKey || !parsed.credentialId.equals(rawId)) fail('WEBAUTHN_FORMAT');
  const { alg, publicKey } = coseToPublicKey(parsed.coseKey);
  return { challenge, credentialId: rawId.toString('base64url'), publicKey, alg };
}

// 확인(서명) 응답 검사. device는 등록부 행 { public_key, alg }. 반환: { challenge, userVerified }
export function verifyAssertion({ clientDataJSON, authenticatorData, signature }, device, { rpId, origin }) {
  const clientData = fromB64url(clientDataJSON, { max: 4096 });
  const authData = fromB64url(authenticatorData, { max: 4096 });
  const sig = fromB64url(signature, { max: 1024 });
  const challenge = readClientData(clientData, { type: 'webauthn.get', origin });
  const parsed = parseAuthData(authData);
  checkFlags(parsed, rpId);
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(device.public_key, 'base64url'), format: 'der', type: 'spki' });
  } catch { fail('WEBAUTHN_KEY_UNSUPPORTED'); }
  const signed = Buffer.concat([authData, sha256(clientData)]);
  let ok = false;
  try {
    if (device.alg === ALG_ES256) ok = verifySignature('sha256', signed, { key, dsaEncoding: 'der' }, sig);
    else if (device.alg === ALG_RS256) ok = verifySignature('sha256', signed, key, sig);
  } catch { ok = false; }
  if (!ok) fail('WEBAUTHN_SIGNATURE');
  return { challenge, userVerified: Boolean(parsed.flags & FLAG_UV) };
}
