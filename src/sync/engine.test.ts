import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from '../db/db';
import { addCashEntry, completeOnboarding, resetAll, type OnboardingData } from '../db/repo';
import { markCleared, resolveConflict, summarizeBackup, syncOnce, takeSnapshot, type Deps } from './engine';
import { trackChanges, changeCount, setSuppressed } from './track';
import { ConflictError, type Precondition, type Remote, type Snapshot, type StateStore, type SyncState } from './types';

/** 서버 흉내: Firestore처럼 updateTime 조건을 검사 */
class FakeServer {
  doc: Snapshot | null = null;
  tick = 0;
  failNext: Error | null = null;
  remote(): Remote {
    return {
      get: async () => {
        if (this.failNext) throw this.failNext;
        return this.doc ? { ...this.doc } : null;
      },
      put: async (json, rev, pre: Precondition) => {
        if ('exists' in pre ? this.doc !== null : this.doc?.updateTime !== pre.updateTime) throw new ConflictError();
        this.doc = { rev, json, updateTime: `t${++this.tick}` };
        return { updateTime: this.doc.updateTime };
      },
    };
  }
}

class MemStore implements StateStore {
  s: SyncState | null = null;
  get() { return this.s; }
  set(s: SyncState) { this.s = s; }
}

const onboarding: OnboardingData = {
  seedMoney: 10_000_000, startDate: '2026-10-16', targets: { stock: 60, bond: 30, cash: 10 },
  schedule: { type: 'firstTradingDay', months: [1, 4, 7, 10] }, accountType: 'general',
  feeRatePct: 0, tolerancePctPoint: 5, notifyTime: '09:00', remindDaysBefore: 7, existing: null,
};

let n = 0;
function device(server: FakeServer) {
  const db = new AppDB(`sync-${Date.now()}-${n++}`);
  const store = new MemStore();
  const deps: Deps = { db, remote: server.remote(), store, suppress: setSuppressed, changeCount };
  return { db, store, deps };
}

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
});

describe('동기화 규칙', () => {
  it('서버가 비어 있고 이 기기에 데이터가 있으면 올린다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    expect((await syncOnce(a.deps)).status).toBe('pushed');
    expect(server.doc?.rev).toBe(1);
    expect(a.store.s).toMatchObject({ rev: 1, dirty: false });
  });

  it('데이터가 없는 새 기기는 서버 데이터를 받는다 (로그인 없이 같은 데이터)', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    expect((await syncOnce(b.deps)).status).toBe('pulled');
    expect((await b.db.settings.get('main'))?.seedMoney).toBe(10_000_000);
    expect(await b.db.ledger.count()).toBe(await a.db.ledger.count());
  });

  it('변경이 없으면 아무것도 하지 않는다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    expect((await syncOnce(a.deps)).status).toBe('noop');
    expect(server.doc?.rev).toBe(1);
  });

  it('A에서 납입하면 B가 받아서 보인다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    await syncOnce(b.deps);

    const stop = trackChanges(a.db, () => a.store.set({ ...a.store.s!, dirty: true }));
    await addCashEntry({ date: '2026-10-20', type: 'deposit', amount: 500_000 }, a.db);
    stop();
    expect(a.store.s?.dirty).toBe(true);
    expect((await syncOnce(a.deps)).status).toBe('pushed');
    expect(server.doc?.rev).toBe(2);

    expect((await syncOnce(b.deps)).status).toBe('pulled');
    expect(await b.db.ledger.count()).toBe(await a.db.ledger.count());
  });

  it('두 기기가 각각 고치면 충돌 → 사용자가 고른다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    await syncOnce(b.deps);

    await addCashEntry({ date: '2026-10-20', type: 'deposit', amount: 100 }, a.db);
    a.store.set({ ...a.store.s!, dirty: true });
    await syncOnce(a.deps);

    await addCashEntry({ date: '2026-10-21', type: 'deposit', amount: 200 }, b.db);
    b.store.set({ ...b.store.s!, dirty: true });
    const r = await syncOnce(b.deps);
    expect(r.status).toBe('conflict');
    expect(await b.db.ledger.count()).toBe(2); // 아직 덮어쓰지 않음

    // 이 기기 것을 선택
    expect((await resolveConflict(b.deps, 'local')).status).toBe('pushed');
    expect(summarizeBackup(server.doc!.json).ledgerCount).toBe(2);
    expect(server.doc?.rev).toBe(3);

    // A는 B의 결과를 받는다
    expect((await syncOnce(a.deps)).status).toBe('pulled');
  });

  it('충돌에서 서버 것을 고르면 이 기기가 서버 내용으로 바뀐다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    await syncOnce(b.deps);
    await addCashEntry({ date: '2026-10-20', type: 'deposit', amount: 100 }, a.db);
    a.store.set({ ...a.store.s!, dirty: true });
    await syncOnce(a.deps);
    await addCashEntry({ date: '2026-10-21', type: 'deposit', amount: 200 }, b.db);
    b.store.set({ ...b.store.s!, dirty: true });
    expect((await syncOnce(b.deps)).status).toBe('conflict');
    await resolveConflict(b.deps, 'remote');
    const amounts = (await b.db.ledger.toArray()).map((l) => l.amount).sort((x, y) => x - y);
    expect(amounts).toEqual([100, 10_000_000]);
  });

  it('이미 데이터가 있는 기기를 처음 연결할 때 서버에도 데이터가 있으면 충돌', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const c = device(server);
    await completeOnboarding({ ...onboarding, seedMoney: 5_000_000 }, c.db);
    expect((await syncOnce(c.deps)).status).toBe('conflict');
  });

  it('올리는 순간 다른 기기가 먼저 저장하면 처음부터 다시 판단한다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    await syncOnce(b.deps);
    await addCashEntry({ date: '2026-10-20', type: 'deposit', amount: 1 }, a.db);
    a.store.set({ ...a.store.s!, dirty: true });

    // a가 get한 뒤 put 하기 전에 b가 저장하는 상황
    const real = a.deps.remote.put;
    let injected = false;
    a.deps.remote.put = async (...args) => {
      if (!injected) {
        injected = true;
        await addCashEntry({ date: '2026-10-21', type: 'deposit', amount: 2 }, b.db);
        b.store.set({ ...b.store.s!, dirty: true });
        await syncOnce(b.deps);
      }
      return real(...args);
    };
    expect((await syncOnce(a.deps)).status).toBe('conflict');
  });

  it('올리는 도중 생긴 변경은 계속 "올리지 않음"으로 남는다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    const real = a.deps.remote.put;
    a.deps.remote.put = async (...args) => {
      const stop = trackChanges(a.db, () => undefined);
      await addCashEntry({ date: '2026-10-22', type: 'deposit', amount: 9 }, a.db);
      stop();
      return real(...args);
    };
    await syncOnce(a.deps);
    expect(a.store.s?.dirty).toBe(true);
  });

  it('서버에서 받는 동안의 변경은 변경으로 세지 않는다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    let fired = 0;
    const stop = trackChanges(b.db, () => fired++);
    await syncOnce(b.deps);
    stop();
    expect(fired).toBe(0);
    expect(b.store.s?.dirty).toBe(false);
  });

  it('한 기기에서 초기화하면 서버와 다른 기기도 비워진다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    await syncOnce(a.deps);
    const b = device(server);
    await syncOnce(b.deps);

    await resetAll(a.db);
    markCleared(a.store);
    expect((await syncOnce(a.deps)).status).toBe('pushed');
    expect(server.doc?.json).toBe('');

    expect((await syncOnce(b.deps)).status).toBe('pulled');
    expect(await b.db.settings.count()).toBe(0);
    expect(await b.db.ledger.count()).toBe(0);
  });

  it('서버 오류는 상태를 바꾸지 않고 전달한다', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    server.failNext = new Error('Firestore 보안 규칙이 접근을 막고 있습니다');
    await expect(syncOnce(a.deps)).rejects.toThrow('보안 규칙');
    expect(a.store.s).toBeNull();
  });

  it('요약: 기록 수·마지막 변경', async () => {
    const a = device(server);
    await completeOnboarding(onboarding, a.db);
    const s = summarizeBackup(await takeSnapshot(a.db));
    expect(s.ledgerCount).toBe(1);
    expect(s.cash).toBe(10_000_000);
    expect(s.lastChange).toBeTruthy();
    expect(summarizeBackup('').ledgerCount).toBe(0);
  });
});
