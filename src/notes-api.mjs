// /api/notes, /api/notes/:id 서버 함수가 함께 쓰는 로그인 검사와 메모 처리입니다.
// 사용자는 src/verify-login.mjs가 검사한 토큰의 userId로만 정합니다.
// 요청 URL·본문의 userId·role·owner_id로 소유자를 정하지 않습니다.
// 키는 Vercel 환경변수에서만 읽고 응답·로그에 넣지 않습니다.
// 4단계 소유자 검사: 모든 읽기·수정·삭제 조회에 owner_id = 검사된 userId 조건을 함께 겁니다.
// 남의 메모와 없는 메모는 같은 404 NOTE_NOT_FOUND로 답해 있는지 없는지 드러내지 않습니다.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TITLE_MAX = 200;
const BODY_MAX = 10000;
const TABLE = 'vault_notes';
// 테이블 칸 이름은 content이고 API는 body를 씁니다. 이름은 여기서만 바꿉니다.
const COLUMNS = 'id, title, content';
const toNote = row => ({ id: row.id, title: row.title, body: row.content });

let cached;
function loadDeps() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
  cached = {
    verifyLogin: createLoginVerifier({ config, supabaseSecretKey: key }),
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
  return cached;
}

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

const OWNER_FIELDS = ['owner_id', 'ownerId', 'user_id', 'userId'];

// ownerOf가 있으면(수정) 본문의 소유자 칸이 검사된 ID와 다를 때 거부합니다.
// 추가에서는 본문의 소유자 칸을 읽지 않고 검사된 ID로 저장합니다.
function readNote(raw, { allowId, ownerOf }) {
  let input = raw;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new HttpError(400, 'INVALID_JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_NOTE');
  if (ownerOf && OWNER_FIELDS.some(key => key in input && input[key] !== ownerOf)) {
    throw new HttpError(403, 'OWNER_CHANGE_FORBIDDEN');
  }
  const { id, title, body } = input;
  if (typeof title !== 'string' || !title.trim() || title.length > TITLE_MAX
      || typeof body !== 'string' || body.length > BODY_MAX) {
    throw new HttpError(400, 'INVALID_NOTE');
  }
  if (allowId && id !== undefined && (typeof id !== 'string' || !UUID.test(id))) {
    throw new HttpError(400, 'INVALID_ID');
  }
  return { id: allowId && id !== undefined ? id.toLowerCase() : undefined, title: title.trim(), body };
}

function checked({ data, error }) {
  if (error) throw error;
  return data;
}

const collection = {
  methods: ['GET', 'POST'],
  async GET({ supabase, login }) {
    const rows = checked(await supabase.from(TABLE).select(COLUMNS)
      .eq('owner_id', login.userId).order('created_at', { ascending: true }));
    return [200, rows.map(toNote)];
  },
  async POST({ supabase, login, request }) {
    const note = readNote(request.body, { allowId: true });
    const id = note.id ?? randomUUID();
    const { error } = await supabase.from(TABLE)
      .insert({ id, owner_id: login.userId, title: note.title, content: note.body });
    if (error?.code === '23505') throw new HttpError(409, 'NOTE_ID_TAKEN');
    if (error) throw error;
    return [201, { id }];
  },
};

const item = {
  methods: ['GET', 'PUT', 'DELETE'],
  async GET({ supabase, id, login }) {
    const row = checked(await supabase.from(TABLE).select(COLUMNS)
      .eq('id', id).eq('owner_id', login.userId).maybeSingle());
    if (!row) throw new HttpError(404, 'NOTE_NOT_FOUND');
    return [200, toNote(row)];
  },
  async PUT({ supabase, id, login, request }) {
    const note = readNote(request.body, { allowId: false, ownerOf: login.userId });
    // 기존 행: owner_id 조건으로 본인 행만 고칩니다. 새 행: owner_id는 바꾸지 않고 결과로 다시 확인합니다.
    const row = checked(await supabase.from(TABLE).update({ title: note.title, content: note.body })
      .eq('id', id).eq('owner_id', login.userId).select(`${COLUMNS}, owner_id`).maybeSingle());
    if (!row) throw new HttpError(404, 'NOTE_NOT_FOUND');
    if (row.owner_id !== login.userId) {
      console.error('notes: 수정 결과의 소유자가 요청한 사용자와 다릅니다.');
      throw new HttpError(500, 'OWNER_CHECK_FAILED');
    }
    return [200, toNote(row)];
  },
  async DELETE({ supabase, id, login }) {
    const row = checked(await supabase.from(TABLE).delete()
      .eq('id', id).eq('owner_id', login.userId).select('id').maybeSingle());
    if (!row) throw new HttpError(404, 'NOTE_NOT_FOUND');
    return [200, { id: row.id }];
  },
};

// route: 'collection'(/api/notes) 또는 'item'(/api/notes/:id)
// getDeps는 로컬 시험에서 가짜 검사기·저장소를 넣을 때만 바꿉니다.
export function createNotesHandler(route, getDeps = loadDeps) {
  const routes = route === 'item' ? item : collection;
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => response.status(status).json(body);
    if (!routes.methods.includes(request.method)) {
      response.setHeader('Allow', routes.methods.join(', '));
      send(405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let deps;
    try {
      deps = getDeps();
    } catch (error) {
      console.error('notes: 설정을 불러오지 못했습니다.', error.message);
      send(500, { error: 'NOTES_NOT_CONFIGURED' });
      return;
    }
    const authorization = request.headers?.authorization;
    const login = authorization ? await deps.verifyLogin(authorization) : null;
    if (!login) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      send(401, { error: authorization ? 'INVALID_LOGIN' : 'LOGIN_REQUIRED' });
      return;
    }
    const id = route === 'item' ? request.query?.id : undefined;
    if (route === 'item' && (typeof id !== 'string' || !UUID.test(id))) {
      send(400, { error: 'INVALID_ID' });
      return;
    }
    try {
      const [status, body] = await routes[request.method]({
        supabase: deps.supabase, login, request, id: id?.toLowerCase(),
      });
      send(status, body);
    } catch (error) {
      if (error instanceof HttpError) {
        send(error.status, { error: error.message });
        return;
      }
      console.error('notes: 자료를 처리하지 못했습니다.', error?.code || 'unknown');
      send(502, { error: 'NOTES_UNAVAILABLE' });
    }
  };
}
