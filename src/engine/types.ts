import type { MoneyInput } from './money';

export type RiskyAsset = 'stock' | 'bond';
export type AssetKey = RiskyAsset | 'cash';
export const RISKY_ASSETS: RiskyAsset[] = ['stock', 'bond'];
export const ALL_ASSETS: AssetKey[] = ['stock', 'bond', 'cash'];

/** 목표 비중 (%, 합계 100) */
export interface Weights {
  stock: number;
  bond: number;
  cash: number;
}

export interface PortfolioState {
  /** 보유 주식 수 (정수) */
  shares: Record<RiskyAsset, number>;
  /** 원화 현금 잔액 */
  cash: MoneyInput;
  /** 평균 매입가 (세금 추정용). 모르면 null */
  avgPrice?: Partial<Record<RiskyAsset, MoneyInput | null>>;
}

/** 1주 가격 (원). 없으면 null → 계산하지 않음 */
export type PriceMap = Record<RiskyAsset, MoneyInput | null | undefined>;

export interface CostSettings {
  /** 매매 수수료율 (%) 예: 0.015 */
  feeRatePct: number;
  /** 매매차익 과세율 (%) 예: 일반계좌 15.4, 연금·ISA 0 */
  taxRatePct: number;
}

export type RebalanceMode = 'cashFirst' | 'full';

export const ASSET_LABEL: Record<AssetKey, string> = {
  stock: '주식',
  bond: '채권',
  cash: '현금',
};
