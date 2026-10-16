import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB } from './db';
import { addCashEntry, cashFromLedger, completeOnboarding, exportBackup, importBackup, netContribution, recordTrades, resetAll, type OnboardingData } from './repo';

const base: OnboardingData = {
  seedMoney: 10_000_000, startDate: '2026-10-16', targets: { stock: 60, bond: 30, cash: 10 },
  schedule: { type: 'firstTradingDay', months: [1, 4, 7, 10] }, accountType: 'taxAdvantaged',
  feeRatePct: 0, tolerancePctPoint: 5, notifyTime: '09:00', remindDaysBefore: 7, existing: null,
};

let db: AppDB;
beforeEach(async () => {
  db = new AppDB(`test-${Math.random()}`);
  await resetAll(db);
});

describe('저장소', () => {
  it('온보딩: 시드머니가 현금·원금으로 기록되고 세율은 계좌 종류를 따른다', async () => {
    await completeOnboarding(base, db);
    const s = await db.settings.get('main');
    expect(s?.taxRatePct).toBe(0);
    const led = await db.ledger.toArray();
    expect(cashFromLedger(led).toNumber()).toBe(10_000_000);
    expect(netContribution(led).toNumber()).toBe(10_000_000);
  });

  it('기존 보유분 입력 시 현금 잔액을 맞춘다', async () => {
    await completeOnboarding({ ...base, existing: { shares: { stock: 100, bond: 50 }, avgPrice: { stock: 20000, bond: 12000 }, cash: 1_500_000 } }, db);
    expect(cashFromLedger(await db.ledger.toArray()).toNumber()).toBe(1_500_000);
    expect((await db.holdings.get('stock'))?.avgPrice).toBe(20000);
  });

  it('체결 기록: 보유 수량·평균 매입가·현금 갱신, 분배금은 원금이 아님', async () => {
    await completeOnboarding(base, db);
    await recordTrades('2026-10-16', [{ asset: 'stock', side: 'buy', shares: 10, price: 25000, fee: 0, tax: 0 }], 'g1', db);
    await recordTrades('2026-10-17', [{ asset: 'stock', side: 'buy', shares: 10, price: 27000, fee: 0, tax: 0 }], 'g2', db);
    const h = await db.holdings.get('stock');
    expect(h?.shares).toBe(20);
    expect(h?.avgPrice).toBe(26000);
    await addCashEntry({ date: '2026-10-18', type: 'distribution', amount: 3000 }, db);
    const led = await db.ledger.toArray();
    expect(cashFromLedger(led).toNumber()).toBe(10_000_000 - 520_000 + 3000);
    expect(netContribution(led).toNumber()).toBe(10_000_000);
  });

  it('현금이 음수가 되는 체결·출금은 거부', async () => {
    await completeOnboarding({ ...base, seedMoney: 10_000 }, db);
    await expect(recordTrades('2026-10-16', [{ asset: 'stock', side: 'buy', shares: 1, price: 25000, fee: 0, tax: 0 }], 'g', db)).rejects.toThrow('음수');
    await expect(addCashEntry({ date: '2026-10-16', type: 'withdraw', amount: 20_000 }, db)).rejects.toThrow();
    expect((await db.holdings.get('stock'))?.shares).toBe(0);
  });

  it('보유보다 많이 매도할 수 없다', async () => {
    await completeOnboarding(base, db);
    await expect(recordTrades('2026-10-16', [{ asset: 'bond', side: 'sell', shares: 1, price: 1, fee: 0, tax: 0 }], 'g', db)).rejects.toThrow();
  });

  it('백업 → 초기화 → 복원', async () => {
    await completeOnboarding(base, db);
    const b = await exportBackup(db);
    await resetAll(db);
    expect(await db.settings.count()).toBe(0);
    await importBackup(b, db);
    expect((await db.settings.get('main'))?.seedMoney).toBe(10_000_000);
    await expect(importBackup({ app: 'x' } as never, db)).rejects.toThrow();
  });
});
