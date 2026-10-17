import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { clearSyncConfigOverride, loadSyncConfig, localStateStore, saveSyncConfigOverride } from './config';
import { markCleared, resolveConflict, summarizeBackup, syncOnce, takeSnapshot, type Deps, type Summary } from './engine';
import { createFirestoreRemote } from './remote';
import { changeCount, setSuppressed, trackChanges } from './track';
import { EMPTY_STATE, type Snapshot, type StateStore, type SyncState } from './types';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'conflict';

export interface ConflictInfo {
  remote: Summary & { rev: number };
  local: Summary;
}

export interface SyncApi {
  enabled: boolean;
  projectId: string;
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  /** 첫 동기화 확인이 끝났는지 (새 기기에서 서버 데이터를 받기 전에 온보딩을 보여주지 않기 위함) */
  initialDone: boolean;
  conflict: ConflictInfo | null;
  syncNow: () => Promise<void>;
  resolve: (choice: 'remote' | 'local') => Promise<void>;
  /** 로컬 초기화 직후 호출: 서버(모든 기기)도 비운다 */
  afterLocalReset: () => Promise<void>;
  saveConnection: (projectId: string, apiKey: string) => void;
  clearConnection: () => void;
}

const Ctx = createContext<SyncApi | null>(null);
const store = localStateStore as StateStore;
const POLL_MS = 60_000;
const DEBOUNCE_MS = 1_500;

export function SyncProvider({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => loadSyncConfig(), []);
  const deps = useMemo<Deps | null>(
    () => (cfg.enabled ? { db, remote: createFirestoreRemote(cfg), store, suppress: setSuppressed, changeCount } : null),
    [cfg],
  );

  const [status, setStatus] = useState<SyncStatus>(cfg.enabled ? 'idle' : 'off');
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLast] = useState<string | null>(store.get()?.lastSyncedAt ?? null);
  const [initialDone, setInitialDone] = useState(!cfg.enabled);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const conflictRemote = useRef<Snapshot | null>(null);

  // 동기화 작업은 한 번에 하나씩 순서대로
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(fn, fn);
    chain.current = p.catch(() => undefined);
    return p;
  }, []);

  const finish = useCallback(() => {
    setStatus('idle');
    setError(null);
    setConflict(null);
    conflictRemote.current = null;
    setLast(store.get()?.lastSyncedAt ?? null);
  }, []);

  const fail = useCallback((e: unknown) => {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setError(offline ? '오프라인입니다. 연결되면 자동으로 다시 시도합니다.' : (e as Error).message || String(e));
    setStatus('error');
  }, []);

  const syncNow = useCallback(async () => {
    if (!deps) return;
    await enqueue(async () => {
      setStatus('syncing');
      try {
        const r = await syncOnce(deps);
        if (r.status === 'conflict') {
          conflictRemote.current = r.remote;
          setConflict({
            remote: { ...summarizeBackup(r.remote.json), rev: r.remote.rev },
            local: summarizeBackup(await takeSnapshot(deps.db)),
          });
          setStatus('conflict');
        } else finish();
      } catch (e) {
        fail(e);
      } finally {
        setInitialDone(true);
      }
    });
  }, [deps, enqueue, fail, finish]);

  const resolve = useCallback(
    async (choice: 'remote' | 'local') => {
      if (!deps) return;
      await enqueue(async () => {
        setStatus('syncing');
        try {
          await resolveConflict(deps, choice);
          finish();
        } catch (e) {
          fail(e);
        }
      });
    },
    [deps, enqueue, fail, finish],
  );

  const afterLocalReset = useCallback(async () => {
    if (!deps) return;
    markCleared(store);
    await syncNow();
  }, [deps, syncNow]);

  // 로컬 변경 → 잠시 뒤 자동으로 서버에 올림
  useEffect(() => {
    if (!deps) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = trackChanges(db, () => {
      const cur: SyncState = store.get() ?? EMPTY_STATE;
      store.set({ ...cur, dirty: true });
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), DEBOUNCE_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [deps, syncNow]);

  // 열 때, 다시 보일 때, 인터넷이 돌아올 때, 1분마다 서버 확인
  useEffect(() => {
    if (!deps) return;
    void syncNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    const onOnline = () => void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(iv);
    };
  }, [deps, syncNow]);

  const api = useMemo<SyncApi>(
    () => ({
      enabled: cfg.enabled,
      projectId: cfg.projectId,
      status,
      lastSyncedAt,
      error,
      initialDone,
      conflict,
      syncNow,
      resolve,
      afterLocalReset,
      saveConnection: (p, k) => {
        saveSyncConfigOverride(p, k);
        location.reload();
      },
      clearConnection: () => {
        clearSyncConfigOverride();
        location.reload();
      },
    }),
    [cfg, status, lastSyncedAt, error, initialDone, conflict, syncNow, resolve, afterLocalReset],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('SyncProvider가 필요합니다.');
  return v;
}
