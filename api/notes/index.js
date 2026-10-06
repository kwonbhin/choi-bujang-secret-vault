// GET /api/notes: 로그인 사용자의 메모 목록, POST /api/notes: 새 메모 {id?, title, body}
import { createNotesHandler } from '../../src/notes-api.mjs';

export default createNotesHandler('collection');
