// POST /api/notes/:id/restore (10단계 복구, 학생 설계·계약에 없음). 로그인 사용자의 메모 한 건만 사본으로 되살립니다.
// 메모 서비스 아래 경로라 판정기 구역 'POST /notes/:id/restore'(zone_note_restore)와 짝을 이룹니다.
// 남의 메모와 없는 메모는 같은 404, 사본 해시가 다르면 409입니다. 처리 코드는 src/restore-api.mjs 그대로입니다.
import { createRestoreHandler } from '../../../src/restore-api.mjs';

export default createRestoreHandler();
