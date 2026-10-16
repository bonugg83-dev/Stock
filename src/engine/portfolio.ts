import { d, percentOf, type Dec } from './money';
import { ALL_ASSETS, RISKY_ASSETS, type AssetKey, type PortfolioState, type PriceMap, type RiskyAsset, type Weights } from './types';

export class MissingPriceError extends Error {
  constructor(public readonly assets: RiskyAsset[]) {
    super(`가격 데이터가 없어 계산할 수 없습니다: ${assets.join(', ')}`);
    this.name = 'MissingPriceError';
  }
}

export interface Valuation {
  values: Record<AssetKey, Dec>;
  total: Dec;
  /** 실제 비중 (%). 전체 평가금액이 0이면 null */
  weights: Record<AssetKey, Dec | null>;
}

/** 가격이 하나라도 없으면 MissingPriceError (보유 여부와 무관하게 계산하지 않음) */
export function requirePrices(prices: PriceMap): Record<RiskyAsset, Dec> {
  const missing = RISKY_ASSETS.filter((a) => {
    const p = prices[a];
    return p === null || p === undefined || !d(p).isFinite() || d(p).lte(0);
  });
  if (missing.length) throw new MissingPriceError(missing);
  return { stock: d(prices.stock!), bond: d(prices.bond!) };
}

/**
 * 자산 평가금액 = 보유 수량 × 현재 가격
 * 전체 평가금액 = 주식 + 채권 + 현금
 * 실제 비중 = 자산 평가금액 ÷ 전체 평가금액 × 100
 */
export function valuePortfolio(state: PortfolioState, prices: PriceMap): Valuation {
  const p = requirePrices(prices);
  const values: Record<AssetKey, Dec> = {
    stock: p.stock.mul(state.shares.stock),
    bond: p.bond.mul(state.shares.bond),
    cash: d(state.cash),
  };
  const total = values.stock.add(values.bond).add(values.cash);
  const weights = Object.fromEntries(ALL_ASSETS.map((a) => [a, percentOf(values[a], total)])) as Record<
    AssetKey,
    Dec | null
  >;
  return { values, total, weights };
}

/** 비중 차이 = 실제 비중 - 목표 비중 (%p) */
export function weightDiffs(v: Valuation, targets: Weights): Record<AssetKey, Dec | null> {
  return Object.fromEntries(
    ALL_ASSETS.map((a) => [a, v.weights[a] === null ? null : v.weights[a]!.sub(targets[a])]),
  ) as Record<AssetKey, Dec | null>;
}

export function maxAbsDiff(diffs: Record<AssetKey, Dec | null>): Dec | null {
  let m: Dec | null = null;
  for (const a of ALL_ASSETS) {
    const x = diffs[a];
    if (x === null) return null;
    if (m === null || x.abs().gt(m)) m = x.abs();
  }
  return m;
}

/** 달러 노출 비중: 환노출형(환헤지 안 함) 자산들의 비중 합 */
export function usdExposurePct(v: Valuation, fxExposed: Record<RiskyAsset, boolean>): Dec | null {
  let sum = d(0);
  for (const a of RISKY_ASSETS) {
    const w = v.weights[a];
    if (w === null) return null;
    if (fxExposed[a]) sum = sum.add(w);
  }
  return sum;
}
