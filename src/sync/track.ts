import type { AppDB } from '../db/db';
import { BACKUP_TABLES } from '../db/repo';

/**
 * 로컬 DB 변경 감지: 백업 대상 테이블에 쓰기가 일어나면 onChange 호출.
 * 서버에서 받은 데이터를 적용하는 동안(suppress)은 무시한다.
 * 알림·가격 캐시 같은 기기별 데이터는 동기화하지 않는다.
 */
let suppressed = false;
let counter = 0;

export const setSuppressed = (on: boolean) => {
  suppressed = on;
};
export const changeCount = () => counter;

export function trackChanges(db: AppDB, onChange: () => void): () => void {
  const fire = () => {
    if (suppressed) return;
    counter += 1;
    onChange();
  };
  // Dexie 훅은 (primKey, obj, trans) 형태로 호출된다. 값을 반환하지 않으면 동작을 바꾸지 않는다.
  const handler = () => {
    fire();
  };
  for (const t of BACKUP_TABLES) {
    const table = db.table(t);
    table.hook('creating', handler);
    table.hook('updating', handler);
    table.hook('deleting', handler);
  }
  return () => {
    for (const t of BACKUP_TABLES) {
      const table = db.table(t);
      table.hook('creating').unsubscribe(handler);
      table.hook('updating').unsubscribe(handler);
      table.hook('deleting').unsubscribe(handler);
    }
  };
}
