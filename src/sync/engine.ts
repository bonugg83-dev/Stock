import type { AppDB } from '../db/db';
import { BACKUP_TABLES, exportBackup, importBackup, type BackupFile } from '../db/repo';
import { ConflictError, EMPTY_STATE, type Remote, type Snapshot, type StateStore, type SyncState } from './types';

/**
 * 기기 간 동기화 규칙 (사용자 한 명, 로그인 없음)
 *
 *  서버 문서 = 전체 기록 스냅샷 + 번호(rev)
 *
 *  - 서버에 아무것도 없고 이 기기에 데이터가 있으면 → 올린다
 *  - 이 기기에 데이터가 없으면(새 기기) → 서버 것을 받는다
 *  - 서버 번호가 더 크고, 이 기기에 올리지 않은 변경이 없으면 → 받는다
 *  - 서버 번호가 더 크고, 이 기기에도 올리지 않은 변경이 있으면 → 충돌: 사용자가 고른다
 *  - 번호가 같고, 이 기기에 올리지 않은 변경이 있으면 → 올린다
 *  - 올리는 순간 다른 기기가 먼저 저장했으면 → 처음부터 다시 판단
 */
export interface Deps {
  db: AppDB;
  remote: Remote;
  store: StateStore;
  /** 서버 데이터를 적용하는 동안 변경 감지를 끈다 */
  suppress: (on: boolean) => void;
  /** 변경 횟수 (올리는 도중 생긴 변경을 놓치지 않기 위함) */
  changeCount: () => number;
  now?: () => string;
}

export type SyncResult =
  | { status: 'noop' | 'pushed' | 'pulled' }
  | { status: 'conflict'; remote: Snapshot };

const nowIso = (d: Deps) => (d.now ? d.now() : new Date().toISOString());

export async function takeSnapshot(db: AppDB): Promise<string> {
  return JSON.stringify(await exportBackup(db));
}

async function clearLocal(db: AppDB) {
  await db.transaction('rw', BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const t of BACKUP_TABLES) await db.table(t).clear();
  });
}

async function pull(d: Deps, remote: Snapshot): Promise<SyncResult> {
  d.suppress(true);
  try {
    if (remote.json === '') await clearLocal(d.db);
    else await importBackup(JSON.parse(remote.json) as BackupFile, d.db);
  } finally {
    d.suppress(false);
  }
  d.store.set({ rev: remote.rev, dirty: false, updateTime: remote.updateTime, lastSyncedAt: nowIso(d), cleared: false });
  return { status: 'pulled' };
}

async function push(d: Deps, rev: number, pre: Parameters<Remote['put']>[2], cleared: boolean): Promise<SyncResult> {
  const before = d.changeCount();
  const json = cleared ? '' : await takeSnapshot(d.db);
  const res = await d.remote.put(json, rev, pre);
  const changedMeanwhile = d.changeCount() !== before;
  d.store.set({ rev, dirty: changedMeanwhile, updateTime: res.updateTime, lastSyncedAt: nowIso(d), cleared: false });
  return { status: 'pushed' };
}

export async function syncOnce(d: Deps, attempt = 0): Promise<SyncResult> {
  try {
    const saved = d.store.get();
    const st: SyncState = saved ?? EMPTY_STATE;
    const remote = await d.remote.get();
    const hasData = (await d.db.settings.count()) > 0;
    // 한 번도 동기화한 적 없는 기기에 데이터가 있으면 "올리지 않은 변경"으로 본다
    const dirty = st.dirty || (!saved && hasData);

    if (st.cleared) {
      // 이 기기에서 초기화함 → 서버도 비운다
      return await push(d, Math.max(st.rev, remote?.rev ?? 0) + 1, remote ? { updateTime: remote.updateTime } : { exists: false }, true);
    }
    if (!remote) {
      if (!hasData) {
        d.store.set({ ...st, dirty: false, lastSyncedAt: nowIso(d) });
        return { status: 'noop' };
      }
      return await push(d, 1, { exists: false }, false);
    }
    if (!hasData) return await pull(d, remote);

    if (remote.rev > st.rev) {
      return dirty ? { status: 'conflict', remote } : await pull(d, remote);
    }
    if (remote.rev === st.rev) {
      if (dirty) return await push(d, st.rev + 1, { updateTime: remote.updateTime }, false);
      d.store.set({ ...st, updateTime: remote.updateTime, lastSyncedAt: nowIso(d) });
      return { status: 'noop' };
    }
    // 서버 번호가 더 작음(서버가 초기화됐거나 다시 만들어짐) → 이 기기 데이터를 기준으로 올린다
    return await push(d, Math.max(st.rev, remote.rev) + 1, { updateTime: remote.updateTime }, false);
  } catch (e) {
    if (e instanceof ConflictError && attempt < 2) return syncOnce(d, attempt + 1);
    throw e;
  }
}

/** 충돌 해결: 서버 것을 쓰거나, 이 기기 것으로 서버를 덮어쓴다 */
export async function resolveConflict(d: Deps, choice: 'remote' | 'local'): Promise<SyncResult> {
  const remote = await d.remote.get();
  if (!remote) return syncOnce(d);
  if (choice === 'remote') return pull(d, remote);
  return push(d, remote.rev + 1, { updateTime: remote.updateTime }, false);
}

/** 이 기기 초기화 직후 호출: 서버도 비우도록 표시 */
export function markCleared(store: StateStore) {
  const cur = store.get() ?? EMPTY_STATE;
  store.set({ ...cur, dirty: true, cleared: true });
}

export interface Summary {
  ledgerCount: number;
  lastChange: string | null;
  cash: number | null;
}

/** 충돌 화면에 보여줄 요약 */
export function summarizeBackup(json: string): Summary {
  if (!json) return { ledgerCount: 0, lastChange: null, cash: null };
  const b = JSON.parse(json) as BackupFile;
  const ledger = (b.tables.ledger ?? []) as { createdAt?: string; amount?: number }[];
  const settings = (b.tables.settings ?? []) as { updatedAt?: string }[];
  const stamps = [...ledger.map((l) => l.createdAt ?? ''), ...settings.map((s) => s.updatedAt ?? '')].filter(Boolean).sort();
  return {
    ledgerCount: ledger.length,
    lastChange: stamps.at(-1) ?? null,
    cash: ledger.reduce((a, l) => a + (l.amount ?? 0), 0),
  };
}
