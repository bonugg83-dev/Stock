import { ceilWon, d, Dec, formatPct, formatPctPoint, formatWon, HUNDRED, percentOf, ZERO, type MoneyInput } from './money';
import { MissingPriceError, requirePrices } from './portfolio';
import {
  ALL_ASSETS,
  ASSET_LABEL,
  RISKY_ASSETS,
  type AssetKey,
  type CostSettings,
  type PortfolioState,
  type PriceMap,
  type RebalanceMode,
  type RiskyAsset,
  type Weights,
} from './types';
import { validateWeights } from './validation';

/**
 * 리밸런싱 / 추가 납입 계산 엔진
 *
 * 1) 전체 투자 가능금액 = 주식 평가금액 + 채권 평가금액 + 현금 + 이번 추가 납입금
 * 2) 목표 금액 = 전체 투자 가능금액 × 목표 비중
 * 3) [매매형만] 목표보다 많은 자산을 정수 주 단위로 매도 (내림)
 * 4) 목표보다 적은 자산을 정수 주 단위로 매수 (내림, 수수료 포함해 현금 한도 안에서)
 * 5) 1주씩 더 사거나(매매형은 팔거나) 되돌려 보며, 목표 비중과의 오차
 *    (각 자산의 (실제 비중 - 목표 비중)² 합)가 더 줄어드는 경우에만 반영
 * 6) 현금은 절대 음수가 되지 않는다.
 *
 * 같은 입력이면 항상 같은 결과가 나온다 (재현 가능).
 */

export interface PlanInput {
  state: PortfolioState;
  prices: PriceMap;
  targets: Weights;
  costs: CostSettings;
  additionalCash?: MoneyInput;
  mode: RebalanceMode;
  /** 허용 오차 (±%p) */
  tolerancePctPoint: number;
}

export type TradeAction = 'buy' | 'sell' | 'hold';

export interface PlanLine {
  asset: AssetKey;
  price: Dec | null;
  sharesBefore: number | null;
  valueBefore: Dec;
  weightBefore: Dec | null;
  targetWeight: Dec;
  targetValue: Dec;
  diffBefore: Dec | null;
  action: TradeAction;
  quantity: number;
  tradeAmount: Dec;
  fee: Dec;
  tax: Dec;
  sharesAfter: number | null;
  valueAfter: Dec;
  weightAfter: Dec | null;
  diffAfter: Dec | null;
}

export interface PlanStep {
  label: string;
  detail: string;
}

export interface Plan {
  ok: true;
  mode: RebalanceMode;
  lines: Record<AssetKey, PlanLine>;
  existingCash: Dec;
  additionalCash: Dec;
  totalBefore: Dec;
  totalAfter: Dec;
  cashAfter: Dec;
  totalFees: Dec;
  totalTax: Dec;
  maxAbsDiffBefore: Dec;
  maxAbsDiffAfter: Dec;
  withinToleranceBefore: boolean;
  withinToleranceAfter: boolean;
  hasTrades: boolean;
  notes: string[];
  steps: PlanStep[];
}

export type PlanErrorCode = 'MISSING_PRICE' | 'INVALID_WEIGHTS' | 'ZERO_TOTAL' | 'INVALID_INPUT';
export interface PlanError {
  ok: false;
  code: PlanErrorCode;
  message: string;
}
export type PlanResult = Plan | PlanError;

type Counts = Record<RiskyAsset, number>;

interface Evaluated {
  cash: Dec;
  shares: Counts;
  values: Record<AssetKey, Dec>;
  total: Dec;
  fees: Record<RiskyAsset, Dec>;
  taxes: Record<RiskyAsset, Dec>;
  dev: Dec;
}

const fail = (code: PlanErrorCode, message: string): PlanError => ({ ok: false, code, message });

export function calculatePlan(input: PlanInput): PlanResult {
  // ---------- 입력 검증 ----------
  let p: Record<RiskyAsset, Dec>;
  try {
    p = requirePrices(input.prices);
  } catch (e) {
    if (e instanceof MissingPriceError) {
      return fail('MISSING_PRICE', `${e.assets.map((a) => ASSET_LABEL[a]).join(', ')} 가격 데이터가 없어 계산을 진행하지 않습니다. 데이터를 다시 불러온 뒤 시도해주세요.`);
    }
    throw e;
  }
  const wc = validateWeights(input.targets);
  if (!wc.ok) return fail('INVALID_WEIGHTS', wc.errors.join(' '));

  for (const a of RISKY_ASSETS) {
    const n = input.state.shares[a];
    if (!Number.isInteger(n) || n < 0) return fail('INVALID_INPUT', `${ASSET_LABEL[a]} 보유 수량은 0 이상의 정수여야 합니다.`);
  }
  const existingCash = d(input.state.cash);
  const additionalCash = d(input.additionalCash ?? 0);
  if (existingCash.isNaN() || existingCash.lt(0)) return fail('INVALID_INPUT', '현금 잔액은 0원 이상이어야 합니다.');
  if (additionalCash.isNaN() || additionalCash.lt(0)) return fail('INVALID_INPUT', '추가 납입금은 0원 이상이어야 합니다.');
  if (input.costs.feeRatePct < 0 || input.costs.taxRatePct < 0) return fail('INVALID_INPUT', '수수료율과 세율은 0 이상이어야 합니다.');

  const feeRate = d(input.costs.feeRatePct).div(HUNDRED);
  const taxRate = d(input.costs.taxRatePct).div(HUNDRED);
  const shares0: Counts = { ...input.state.shares };
  const cash0 = existingCash.add(additionalCash);
  const avg: Record<RiskyAsset, Dec | null> = {
    stock: input.state.avgPrice?.stock != null ? d(input.state.avgPrice.stock) : null,
    bond: input.state.avgPrice?.bond != null ? d(input.state.avgPrice.bond) : null,
  };
  const target: Record<AssetKey, Dec> = {
    stock: d(input.targets.stock),
    bond: d(input.targets.bond),
    cash: d(input.targets.cash),
  };

  const steps: PlanStep[] = [];
  const evaluate = (buy: Counts, sell: Counts): Evaluated => {
    let cash = cash0;
    const shares = { ...shares0 };
    const fees = { stock: ZERO, bond: ZERO };
    const taxes = { stock: ZERO, bond: ZERO };
    for (const a of RISKY_ASSETS) {
      if (buy[a] > 0) {
        const gross = p[a].mul(buy[a]);
        fees[a] = ceilWon(gross.mul(feeRate));
        cash = cash.sub(gross).sub(fees[a]);
        shares[a] += buy[a];
      }
      if (sell[a] > 0) {
        const gross = p[a].mul(sell[a]);
        fees[a] = ceilWon(gross.mul(feeRate));
        const gain = avg[a] === null ? ZERO : Dec.max(ZERO, p[a].sub(avg[a]!).mul(sell[a]));
        taxes[a] = ceilWon(gain.mul(taxRate));
        cash = cash.add(gross).sub(fees[a]).sub(taxes[a]);
        shares[a] -= sell[a];
      }
    }
    const values: Record<AssetKey, Dec> = { stock: p.stock.mul(shares.stock), bond: p.bond.mul(shares.bond), cash };
    const total = values.stock.add(values.bond).add(values.cash);
    let dev = ZERO;
    if (!total.isZero()) {
      for (const a of ALL_ASSETS) {
        const diff = values[a].div(total).mul(HUNDRED).sub(target[a]);
        dev = dev.add(diff.mul(diff));
      }
    }
    return { cash, shares, values, total, fees, taxes, dev };
  };

  const none: Counts = { stock: 0, bond: 0 };
  const before = evaluate(none, none);
  if (before.total.isZero()) {
    return fail('ZERO_TOTAL', '전체 평가금액과 추가 납입금이 모두 0원이라 계산할 수 없습니다. 먼저 잔고에 돈을 넣어주세요.');
  }
  const total0 = before.total;
  const targetValue: Record<AssetKey, Dec> = {
    stock: total0.mul(target.stock).div(HUNDRED),
    bond: total0.mul(target.bond).div(HUNDRED),
    cash: total0.mul(target.cash).div(HUNDRED),
  };

  steps.push({
    label: '1. 현재 상태',
    detail: RISKY_ASSETS.map((a) => `${ASSET_LABEL[a]} ${shares0[a]}주 × ${formatWon(p[a])} = ${formatWon(before.values[a])}`)
      .concat([`현금 ${formatWon(existingCash)} + 추가 납입 ${formatWon(additionalCash)} = ${formatWon(cash0)}`])
      .join('\n'),
  });
  steps.push({ label: '2. 전체 투자 가능금액', detail: `${formatWon(total0)} (정확한 값: ${total0.toString()}원)` });
  steps.push({
    label: '3. 목표 금액 (전체 × 목표 비중)',
    detail: ALL_ASSETS.map((a) => `${ASSET_LABEL[a]}: ${formatWon(total0)} × ${target[a].toString()}% = ${formatWon(targetValue[a])}`).join('\n'),
  });

  // ---------- 1차: 정수 주 단위 매도(매매형) / 매수 ----------
  const buy: Counts = { stock: 0, bond: 0 };
  const sell: Counts = { stock: 0, bond: 0 };

  if (input.mode === 'full') {
    for (const a of RISKY_ASSETS) {
      const excess = before.values[a].sub(targetValue[a]);
      if (excess.gt(0)) sell[a] = Math.min(shares0[a], excess.div(p[a]).floor().toNumber());
    }
  }
  const afterSell = evaluate(none, sell);
  for (const a of RISKY_ASSETS) {
    if (sell[a] > 0) continue;
    const deficit = targetValue[a].sub(afterSell.values[a]);
    if (deficit.gt(0)) buy[a] = deficit.div(p[a].mul(d(1).add(feeRate))).floor().toNumber();
  }
  // 현금 한도를 넘으면 비율대로 줄이고, 그래도 넘으면 1주씩 줄인다
  let trial = evaluate(buy, sell);
  if (trial.cash.lt(0)) {
    const spend = RISKY_ASSETS.reduce((acc, a) => acc.add(p[a].mul(buy[a]).mul(d(1).add(feeRate))), ZERO);
    const factor = Dec.max(ZERO, afterSell.cash).div(spend);
    for (const a of RISKY_ASSETS) buy[a] = d(buy[a]).mul(factor).floor().toNumber();
    trial = evaluate(buy, sell);
    while (trial.cash.lt(0)) {
      const a = RISKY_ASSETS.filter((x) => buy[x] > 0).sort((x, y) => p[y].mul(buy[y]).cmp(p[x].mul(buy[x])))[0];
      if (!a) break;
      buy[a] -= 1;
      trial = evaluate(buy, sell);
    }
  }
  steps.push({
    label: '4. 1차 계산 (목표 금액 차이 ÷ 1주 가격, 정수 내림)',
    detail: RISKY_ASSETS.map((a) =>
      sell[a] > 0 ? `${ASSET_LABEL[a]}: ${sell[a]}주 매도` : buy[a] > 0 ? `${ASSET_LABEL[a]}: ${buy[a]}주 매수` : `${ASSET_LABEL[a]}: 변동 없음`,
    ).join('\n'),
  });

  // ---------- 2차: 1주 단위 미세 조정 ----------
  let current = evaluate(buy, sell);
  let iterations = 0;
  const EPS = d('1e-18');
  while (iterations < 100000) {
    iterations += 1;
    type Move = { buy: Counts; sell: Counts };
    const moves: Move[] = [];
    for (const a of RISKY_ASSETS) {
      if (sell[a] === 0) moves.push({ buy: { ...buy, [a]: buy[a] + 1 }, sell });
      if (buy[a] > 0) moves.push({ buy: { ...buy, [a]: buy[a] - 1 }, sell });
      if (input.mode === 'full') {
        if (buy[a] === 0 && sell[a] < shares0[a]) moves.push({ buy, sell: { ...sell, [a]: sell[a] + 1 } });
        if (sell[a] > 0) moves.push({ buy, sell: { ...sell, [a]: sell[a] - 1 } });
      }
    }
    // 교환 이동: 한 자산 매수를 1주 줄이고 다른 자산을 k주 늘린다 (현금이 빠듯할 때 국소해에 갇히지 않도록)
    for (const a of RISKY_ASSETS) {
      for (const b of RISKY_ASSETS) {
        if (a === b || buy[a] === 0 || sell[b] > 0) continue;
        const maxK = Math.min(50, p[a].div(p[b]).ceil().toNumber() + 1);
        for (let k = 1; k <= maxK; k++) moves.push({ buy: { ...buy, [a]: buy[a] - 1, [b]: buy[b] + k }, sell });
      }
    }
    let best: { move: Move; ev: Evaluated } | null = null;
    for (const m of moves) {
      const ev = evaluate(m.buy, m.sell);
      if (ev.cash.lt(0)) continue;
      if (ev.dev.lt(current.dev.sub(EPS)) && (best === null || ev.dev.lt(best.ev.dev))) best = { move: m, ev };
    }
    if (!best) break;
    Object.assign(buy, best.move.buy);
    Object.assign(sell, best.move.sell);
    current = best.ev;
  }
  steps.push({
    label: '5. 1주 단위 미세 조정',
    detail: `1주씩 더하거나 빼며 목표 비중과의 오차가 줄어드는지 확인 (${iterations - 1}회 조정)\n최종: ${RISKY_ASSETS.map((a) =>
      sell[a] > 0 ? `${ASSET_LABEL[a]} ${sell[a]}주 매도` : buy[a] > 0 ? `${ASSET_LABEL[a]} ${buy[a]}주 매수` : `${ASSET_LABEL[a]} 유지`,
    ).join(', ')}`,
  });

  // ---------- 결과 정리 ----------
  const after = current;
  const tol = d(input.tolerancePctPoint);
  const lines = {} as Record<AssetKey, PlanLine>;
  let maxBefore = ZERO;
  let maxAfter = ZERO;
  for (const a of ALL_ASSETS) {
    const wBefore = percentOf(before.values[a], total0)!;
    const wAfter = percentOf(after.values[a], after.total);
    const diffBefore = wBefore.sub(target[a]);
    const diffAfter = wAfter === null ? null : wAfter.sub(target[a]);
    maxBefore = Dec.max(maxBefore, diffBefore.abs());
    if (diffAfter) maxAfter = Dec.max(maxAfter, diffAfter.abs());
    const risky = a !== 'cash';
    const qty = risky ? (buy[a] || sell[a]) : 0;
    lines[a] = {
      asset: a,
      price: risky ? p[a] : null,
      sharesBefore: risky ? shares0[a] : null,
      valueBefore: before.values[a],
      weightBefore: wBefore,
      targetWeight: target[a],
      targetValue: targetValue[a],
      diffBefore,
      action: risky ? (buy[a] > 0 ? 'buy' : sell[a] > 0 ? 'sell' : 'hold') : 'hold',
      quantity: qty,
      tradeAmount: risky ? p[a].mul(qty) : ZERO,
      fee: risky ? after.fees[a] : ZERO,
      tax: risky ? after.taxes[a] : ZERO,
      sharesAfter: risky ? after.shares[a] : null,
      valueAfter: after.values[a],
      weightAfter: wAfter,
      diffAfter,
    };
  }
  const totalFees = after.fees.stock.add(after.fees.bond);
  const totalTax = after.taxes.stock.add(after.taxes.bond);
  const hasTrades = RISKY_ASSETS.some((a) => buy[a] > 0 || sell[a] > 0);

  // 비중 합계 검증 (100%에 가까운지)
  const weightSum = ALL_ASSETS.reduce((acc, a) => acc.add(lines[a].weightAfter ?? ZERO), ZERO);
  steps.push({
    label: '6. 거래 후 검증',
    detail: `거래 후 비중 합계: ${formatPct(weightSum, 6)} / 남는 현금: ${formatWon(after.cash)} (음수 아님: ${after.cash.gte(0) ? '확인' : '오류'})\n수수료 합계 ${formatWon(totalFees)}, 세금(추정) 합계 ${formatWon(totalTax)}`,
  });

  const notes: string[] = [];
  const withinToleranceBefore = maxBefore.lte(tol);
  const withinToleranceAfter = maxAfter.lte(tol);
  if (withinToleranceBefore) {
    notes.push(`현재 비중이 허용 오차(±${tol.toString()}%p) 안에 있어, 계산상 조정이 꼭 필요한 상태는 아닙니다.`);
  }
  const minPrice = Dec.min(p.stock, p.bond);
  if (additionalCash.gt(0) && additionalCash.lt(minPrice) && !hasTrades) {
    notes.push(`추가 납입금(${formatWon(additionalCash)})이 1주 가격(최저 ${formatWon(minPrice)})보다 작아 이번에는 매수할 수 있는 자산이 없습니다. 현금으로 보유됩니다.`);
  }
  if (input.mode === 'cashFirst') {
    const over = RISKY_ASSETS.filter((a) => lines[a].diffAfter !== null && lines[a].diffAfter!.gt(tol));
    if (over.length) {
      notes.push(
        `매도 없이 현금과 납입금만으로는 목표 비중을 맞출 수 없습니다. ${over
          .map((a) => `${ASSET_LABEL[a]} 비중이 목표보다 ${formatPctPoint(lines[a].diffAfter)} 높습니다`)
          .join(', ')}. 다음 리밸런싱 때 매도를 포함한 조정(매매형)이 필요할 수 있습니다.`,
      );
    }
    const under = RISKY_ASSETS.filter((a) => lines[a].diffAfter !== null && lines[a].diffAfter!.lt(tol.neg()));
    if (under.length && !over.length) {
      notes.push(`현금이 부족해 ${under.map((a) => ASSET_LABEL[a]).join(', ')} 비중을 목표까지 채우지 못했습니다. 추가 납입이나 매매형 조정을 검토할 수 있습니다.`);
    }
  }
  if (!maxAfter.isZero()) {
    notes.push(
      `주식은 1주 단위로만 거래하므로 목표 비중을 정확히 맞출 수 없습니다. 거래 후 최대 오차는 ${formatPctPoint(maxAfter).replace('+', '±')}이며, 허용 오차(±${tol.toString()}%p) ${withinToleranceAfter ? '이내' : '를 초과'}입니다.`,
    );
  }
  if (totalTax.gt(0)) {
    notes.push(`매도 시 매매차익 과세 추정액 ${formatWon(totalTax)}이 포함되었습니다. 실제 세금은 과세표준기준가격 등에 따라 다를 수 있습니다.`);
  }
  if (input.mode === 'full' && RISKY_ASSETS.some((a) => sell[a] > 0 && avg[a] === null) && input.costs.taxRatePct > 0) {
    notes.push('평균 매입가가 입력되지 않은 자산은 매매차익 세금을 0원으로 가정했습니다.');
  }

  return {
    ok: true,
    mode: input.mode,
    lines,
    existingCash,
    additionalCash,
    totalBefore: total0,
    totalAfter: after.total,
    cashAfter: after.cash,
    totalFees,
    totalTax,
    maxAbsDiffBefore: maxBefore,
    maxAbsDiffAfter: maxAfter,
    withinToleranceBefore,
    withinToleranceAfter,
    hasTrades,
    notes,
    steps,
  };
}
