import base from '../config/sync.json';
import type { SyncConfig } from './remote';

const OVERRIDE_KEY = 'rebalance-sync-config';

export function loadSyncConfig(): SyncConfig & { enabled: boolean } {
  let o: Partial<SyncConfig> = {};
  try {
    o = JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? '{}') as Partial<SyncConfig>;
  } catch {
    /* 무시 */
  }
  const cfg: SyncConfig = {
    projectId: (o.projectId || base.projectId || '').trim(),
    apiKey: (o.apiKey || base.apiKey || '').trim(),
    endpoint: (o.endpoint || base.endpoint).replace(/\/$/, ''),
    collection: base.collection,
    docId: base.docId,
  };
  return { ...cfg, enabled: !!cfg.projectId && !!cfg.apiKey };
}

export function saveSyncConfigOverride(projectId: string, apiKey: string) {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ projectId: projectId.trim(), apiKey: apiKey.trim() }));
  } catch {
    /* 저장 실패 */
  }
}

export function clearSyncConfigOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* 무시 */
  }
}

const STATE_KEY = 'rebalance-sync-state';
let memory: string | null = null;

/** localStorage에 동기화 상태 저장 (막혀 있으면 메모리) */
export const localStateStore = {
  get() {
    let raw = memory;
    try {
      raw = localStorage.getItem(STATE_KEY) ?? memory;
    } catch {
      /* 메모리 사용 */
    }
    return raw ? JSON.parse(raw) : null;
  },
  set(s: unknown) {
    memory = JSON.stringify(s);
    try {
      localStorage.setItem(STATE_KEY, memory);
    } catch {
      /* 메모리만 */
    }
  },
};
