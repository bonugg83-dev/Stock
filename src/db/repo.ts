import { d, ZERO, type Dec } from '../engine/money';
import { RISKY_ASSETS, type RiskyAsset } from '../engine/types';
import assetConfig from '../config/assets.json';
import { db, type AppDB } from './db';
import type {
  AccountType,
  CashLedgerEntry,
  Holding,
  RebalanceRecord,
  UserSettings,
} from './schema';
import type { RebalanceSchedule } from '../engine/schedule';
import type { Weights } from '../engine/types';

export const TAX_RATE_BY_ACCOUNT: Record<AccountType, number> = { general: 15.4, taxAdvantaged: 0 };

const nowIso = () => new Date().toISOString();

export function defaultSettings(): Omit<UserSettings, 'seedMoney' | 'startDate' | 'createdAt' | 'updatedAt'> {
  return {
    id: 'main',
    userId: crypto.randomUUID(),
    currency: 'KRW',
    assets: {
      stock: { ...assetConfig.stock },
      bond: { ...assetConfig.bond },
    },
    targets: { stock: 60, bond: 30, cash: 10 },
    schedule: { type: 'firstTradingDay', months: [1, 4, 7, 10] },
    tolerancePctPoint: 5,
    feeRatePct: 0,
    accountType: 'general',
    taxRatePct: TAX_RATE_BY_ACCOUNT.general,
    rebalanceMode: 'cashFirst',
    notifyTime: '09:00',
    remindDaysBefore: 7,
    staleAfterBusinessDays: 2,
    riskFreeRatePct: 3,
    dataSource: 'live',
  };
}

export interface OnboardingData {
  seedMoney: number;
  startDate: string;
  targets: Weights;
  schedule: RebalanceSchedule;
  accountType: AccountType;
  feeRatePct: number;
  tolerancePctPoint: number;
  notifyTime: string;
  remindDaysBefore: number;
  /** 이미 보유 중인 경우 */
  existing: null | {
    shares: Record<RiskyAsset, number>;
    avgPrice: Record<RiskyAsset, number | null>;
    cash: number;
  };
}

export async function completeOnboarding(data: OnboardingData, database: AppDB = db): Promise<void> {
  const ts = nowIso();
  const settings: UserSettings = {
    ...defaultSettings(),
    seedMoney: data.seedMoney,
    startDate: data.startDate,
    targets: data.targets,
    schedule: data.schedule,
    accountType: data.accountType,
    taxRatePct: TAX_RATE_BY_ACCOUNT[data.accountType],
    feeRatePct: data.feeRatePct,
    tolerancePctPoint: data.tolerancePctPoint,
    notifyTime: data.notifyTime,
    remindDaysBefore: data.remindDaysBefore,
    createdAt: ts,
    updatedAt: ts,
  };
  await database.transaction('rw', [database.settings, database.holdings, database.ledger, database.settingsHistory], async () => {
    await database.settings.put(settings);
    await database.ledger.add({ date: data.startDate, type: 'deposit', amount: data.seedMoney, memo: '초기 시드머니', createdAt: ts });
    let cash = d(data.seedMoney);
    for (const a of RISKY_ASSETS) {
      const shares = data.existing?.shares[a] ?? 0;
      const avg = data.existing?.avgPrice[a] ?? null;
      const cost = avg !== null ? d(avg).mul(shares) : ZERO;
      await database.holdings.put({ asset: a, shares, avgPrice: shares > 0 ? avg : null, costBasis: cost.toNumber(), asOf: data.startDate });
      if (shares > 0) {
        await database.ledger.add({ date: data.startDate, type: 'buy', amount: cost.neg().toNumber(), asset: a, shares, price: avg ?? 0, memo: '기존 보유분 (평균 매입가 기준)', createdAt: ts });
        cash = cash.sub(cost);
      }
    }
    if (data.existing) {
      const adjust = d(data.existing.cash).sub(cash);
      if (!adjust.isZero()) {
        await database.ledger.add({ date: data.startDate, type: 'adjust', amount: adjust.toNumber(), memo: '초기 현금 잔액 맞춤 (원금과 보유 평가 차이)', createdAt: ts });
      }
    }
    await database.settingsHistory.add({ changedAt: ts, summary: '초기 설정', before: {}, after: settings });
  });
}

export async function updateSettings(patch: Partial<UserSettings>, summary: string, database: AppDB = db): Promise<void> {
  await database.transaction('rw', database.settings, database.settingsHistory, async () => {
    const cur = await database.settings.get('main');
    if (!cur) throw new Error('설정이 없습니다.');
    const before: Partial<UserSettings> = {};
    for (const k of Object.keys(patch) as (keyof UserSettings)[]) (before as Record<string, unknown>)[k] = cur[k];
    const ts = nowIso();
    await database.settings.put({ ...cur, ...patch, updatedAt: ts });
    await database.settingsHistory.add({ changedAt: ts, summary, before, after: patch });
  });
}

/** 현금 잔액 = 장부 합계 */
export function cashFromLedger(entries: CashLedgerEntry[]): Dec {
  return entries.reduce((acc, e) => acc.add(d(e.amount)), ZERO);
}

/** 순납입원금 = 납입 - 출금 (분배금은 수익이므로 제외) */
export function netContribution(entries: CashLedgerEntry[]): Dec {
  return entries.reduce(
    (acc, e) => (e.type === 'deposit' ? acc.add(d(e.amount)) : e.type === 'withdraw' ? acc.add(d(e.amount)) : acc),
    ZERO,
  );
}

export async function addCashEntry(
  entry: { date: string; type: 'deposit' | 'withdraw' | 'distribution'; amount: number; memo?: string },
  database: AppDB = db,
): Promise<void> {
  const amount = entry.type === 'withdraw' ? -Math.abs(entry.amount) : Math.abs(entry.amount);
  if (entry.type === 'withdraw') {
    const cash = cashFromLedger(await database.ledger.toArray());
    if (cash.add(amount).lt(0)) throw new Error('현금 잔액보다 많이 출금할 수 없습니다.');
  }
  await database.ledger.add({ ...entry, amount, createdAt: nowIso() });
}

export interface ExecutedTrade {
  asset: RiskyAsset;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
  fee: number;
  tax: number;
}

/** 사용자가 실제로 체결한 거래를 기록: 보유 수량·평균 매입가·현금 장부를 함께 갱신 */
export async function recordTrades(date: string, trades: ExecutedTrade[], groupId: string, database: AppDB = db): Promise<void> {
  await database.transaction('rw', database.holdings, database.ledger, async () => {
    const ts = nowIso();
    let cash = cashFromLedger(await database.ledger.toArray());
    for (const t of trades) {
      if (!Number.isInteger(t.shares) || t.shares <= 0) continue;
      const h: Holding = (await database.holdings.get(t.asset)) ?? { asset: t.asset, shares: 0, avgPrice: null, costBasis: 0, asOf: date };
      const gross = d(t.price).mul(t.shares);
      if (t.side === 'buy') {
        const newCost = d(h.costBasis).add(gross);
        const newShares = h.shares + t.shares;
        await database.holdings.put({ asset: t.asset, shares: newShares, costBasis: newCost.toNumber(), avgPrice: newCost.div(newShares).toNumber(), asOf: date });
        cash = cash.sub(gross);
        await database.ledger.add({ date, type: 'buy', amount: gross.neg().toNumber(), asset: t.asset, shares: t.shares, price: t.price, groupId, createdAt: ts });
      } else {
        if (t.shares > h.shares) throw new Error('보유 수량보다 많이 매도할 수 없습니다.');
        const newShares = h.shares - t.shares;
        const newCost = newShares === 0 ? ZERO : d(h.costBasis).mul(newShares).div(h.shares);
        await database.holdings.put({ asset: t.asset, shares: newShares, costBasis: newCost.toNumber(), avgPrice: newShares === 0 ? null : h.avgPrice, asOf: date });
        cash = cash.add(gross);
        await database.ledger.add({ date, type: 'sell', amount: gross.toNumber(), asset: t.asset, shares: t.shares, price: t.price, groupId, createdAt: ts });
      }
      if (t.fee > 0) {
        cash = cash.sub(t.fee);
        await database.ledger.add({ date, type: 'fee', amount: -t.fee, asset: t.asset, groupId, createdAt: ts });
      }
      if (t.tax > 0) {
        cash = cash.sub(t.tax);
        await database.ledger.add({ date, type: 'tax', amount: -t.tax, asset: t.asset, groupId, createdAt: ts });
      }
    }
    if (cash.lt(0)) throw new Error('거래 후 현금이 음수가 됩니다. 수량이나 가격을 확인해주세요.');
  });
}

export async function saveRebalanceRecord(rec: Omit<RebalanceRecord, 'id'>, database: AppDB = db): Promise<number> {
  return database.rebalances.add(rec);
}

export async function markExecuted(id: number, memo: string, database: AppDB = db): Promise<void> {
  await database.rebalances.update(id, { executed: true, executedAt: nowIso(), executionMemo: memo });
}

// ---------- 백업 / 초기화 ----------

export interface BackupFile {
  app: 'rebalance-app';
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

const BACKUP_TABLES = ['settings', 'holdings', 'ledger', 'rebalances', 'distributions', 'settingsHistory'] as const;

export async function exportBackup(database: AppDB = db): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = await database.table(t).toArray();
  return { app: 'rebalance-app', version: 1, exportedAt: nowIso(), tables };
}

export async function importBackup(file: BackupFile, database: AppDB = db): Promise<void> {
  if (file?.app !== 'rebalance-app' || file.version !== 1 || !file.tables?.settings?.length) {
    throw new Error('이 앱의 백업 파일이 아니거나 형식이 올바르지 않습니다.');
  }
  await database.transaction('rw', BACKUP_TABLES.map((t) => database.table(t)), async () => {
    for (const t of BACKUP_TABLES) {
      await database.table(t).clear();
      await database.table(t).bulkAdd(file.tables[t] ?? []);
    }
  });
}

export async function resetAll(database: AppDB = db): Promise<void> {
  await Promise.all(database.tables.map((t) => t.clear()));
}
