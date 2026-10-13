// POST /api/restores/:id (10단계 복구, 학생 설계·계약에 없음). 로그인 사용자의 메모 한 건만 사본으로 되살립니다.
// 남의 메모와 없는 메모는 같은 404, 사본 해시가 다르면 409입니다.
import { createRestoreHandler } from '../../src/restore-api.mjs';

export default createRestoreHandler();
