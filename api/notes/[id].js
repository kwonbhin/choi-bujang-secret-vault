// GET·PUT·DELETE /api/notes/:id (본인 메모만, 남의 메모와 없는 메모는 같은 404)
import { createNotesHandler } from '../../src/notes-api.mjs';

export default createNotesHandler('item');
