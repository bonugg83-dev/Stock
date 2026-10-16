import type { RebalanceSchedule } from '../engine/schedule';
import type { RebalanceMode, Weights, RiskyAsset } from '../engine/types';
import type { MarketFile } from '../data/marketTypes';

/** 계좌 종류: 매매차익 세금 계산에 사용 */
export type AccountType = 'general' | 'taxAdvantaged';

export interface AssetConfig {
  code: string;
  name: string;
  fxExposed: boolean;
}

export interface UserSettings {
  id: 'main';
  userId: string;
  seedMoney: number;
  startDate: string;
  currency: 'KRW';
  assets: Record<RiskyAsset, AssetConfig>;
  targets: Weights;
  schedule: RebalanceSchedule;
  tolerancePctPoint: number;
  feeRatePct: number;
  accountType: AccountType;
  taxRatePct: number;
  rebalanceMode: RebalanceMode;
  notifyTime: string;
  remindDaysBefore: number;
  staleAfterBusinessDays: number;
  /** 무위험수익률 (%/년, CAPM·샤프지수용) */
  riskFreeRatePct: number;
  dataSource: 'live' | 'mock';
  createdAt: string;
  updatedAt: string;
}

export interface Holding {
  asset: RiskyAsset;
  shares: number;
  /** 평균 매입가 (원/주), 모르면 null */
  avgPrice: number | null;
  /** 매입 원가 합계 (원) */
  costBasis: number;
  asOf: string;
}

/** 현금 장부: 모든 현금 변동 기록 (수익률 계산의 근거) */
export type LedgerType = 'deposit' | 'withdraw' | 'distribution' | 'buy' | 'sell' | 'fee' | 'tax' | 'adjust';

export interface CashLedgerEntry {
  id?: number;
  date: string;
  type: LedgerType;
  /** 현금 증감 (+ 입금 / - 출금) */
  amount: number;
  asset?: RiskyAsset;
  shares?: number;
  price?: number;
  memo?: string;
  /** 같은 거래 묶음 (예: 리밸런싱 실행 기록 id) */
  groupId?: string;
  createdAt: string;
}

export interface PlanSnapshotLine {
  asset: 'stock' | 'bond' | 'cash';
  action: 'buy' | 'sell' | 'hold';
  quantity: number;
  price: number | null;
  weightBefore: number | null;
  weightAfter: number | null;
  targetWeight: number;
}

export interface RebalanceRecord {
  id?: number;
  kind: 'rebalance' | 'deposit';
  calculatedAt: string;
  priceDate: string | null;
  prices: Record<RiskyAsset, number>;
  mode: RebalanceMode;
  additionalCash: number;
  totalBefore: number;
  totalAfter: number;
  targets: Weights;
  lines: PlanSnapshotLine[];
  notes: string[];
  /** 사용자가 계산 결과를 확인했는지 */
  confirmed: boolean;
  /** 사용자가 실제 매매 실행을 기록했는지 */
  executed: boolean;
  executedAt?: string;
  executionMemo?: string;
}

export interface DistributionRecord {
  id?: number;
  asset: RiskyAsset;
  recordDate: string;
  payDate: string | null;
  perShare: number;
  sharesHeld: number;
  gross: number;
  tax: number;
  net: number;
  status: 'pending' | 'applied' | 'dismissed';
  source: 'auto' | 'manual';
}

export interface NotificationRecord {
  key: string;
  level: 'info' | 'warning';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface SettingsHistoryEntry {
  id?: number;
  changedAt: string;
  summary: string;
  before: Partial<UserSettings>;
  after: Partial<UserSettings>;
}

export interface MetaEntry {
  key: 'lastMarket';
  value: MarketFile;
  savedAt: string;
}
