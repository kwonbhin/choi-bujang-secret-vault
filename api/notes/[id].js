// GET·PUT·DELETE /api/notes/:id (아직 소유자 검사 없음, 4단계에서 고침)
import { createNotesHandler } from '../../src/notes-api.mjs';

export default createNotesHandler('item');
