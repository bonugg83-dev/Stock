import { describe, expect, it } from 'vitest';
import { calculatePlan, type Plan, type PlanInput, type PlanResult } from './allocate';
import { d } from './money';
import { RISKY_ASSETS, ALL_ASSETS } from './types';

const PRICES = { stock: 25000, bond: 12000 };
const NO_COST = { feeRatePct: 0, taxRatePct: 0 };

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  state: { shares: { stock: 0, bond: 0 }, cash: 0 },
  prices: PRICES,
  targets: { stock: 60, bond: 30, cash: 10 },
  costs: NO_COST,
  mode: 'cashFirst',
  tolerancePctPoint: 5,
  ...over,
});

const ok = (r: PlanResult): Plan => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

/** 모든 결과에 공통으로 성립해야 하는 불변 조건 */
function checkInvariants(plan: Plan, input: PlanInput) {
  expect(plan.cashAfter.gte(0)).toBe(true);
  for (const a of RISKY_ASSETS) {
    expect(Number.isInteger(plan.lines[a].quantity)).toBe(true);
    expect(Number.isInteger(plan.lines[a].sharesAfter!)).toBe(true);
    expect(plan.lines[a].sharesAfter!).toBeGreaterThanOrEqual(0);
  }
  const sum = ALL_ASSETS.reduce((acc, a) => acc.add(plan.lines[a].weightAfter ?? 0), d(0));
  expect(sum.sub(100).abs().lt('1e-20')).toBe(true);
  // 돈이 새거나 생기지 않는다: 전후 총액 차이 = 수수료 + 세금
  expect(plan.totalBefore.sub(plan.totalAfter).eq(plan.totalFees.add(plan.totalTax))).toBe(true);
  if (input.mode === 'cashFirst') {
    for (const a of RISKY_ASSETS) expect(plan.lines[a].action).not.toBe('sell');
  }
}

describe('입력 검증', () => {
  it('비중 합계가 100%가 아니면 계산하지 않고 부족분을 알려준다', () => {
    const r = calculatePlan(base({ targets: { stock: 60, bond: 30, cash: 5 }, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID_WEIGHTS');
      expect(r.message).toContain('5%p 부족');
    }
  });

  it('비중 합계가 100%를 초과하면 초과분을 알려준다', () => {
    const r = calculatePlan(base({ targets: { stock: 70, bond: 30, cash: 10 }, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } }));
    expect(!r.ok && r.message).toContain('10%p 초과');
  });

  it('목표 비중이 모두 0이면 오류', () => {
    const r = calculatePlan(base({ targets: { stock: 0, bond: 0, cash: 0 }, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } }));
    expect(!r.ok && r.code).toBe('INVALID_WEIGHTS');
  });

  it('잔고와 납입금이 모두 0원이면(시드머니 0) 계산하지 않는다', () => {
    const r = calculatePlan(base());
    expect(!r.ok && r.code).toBe('ZERO_TOTAL');
  });

  it('가격 데이터가 없으면 계산하지 않는다 (API 실패)', () => {
    const r = calculatePlan(base({ prices: { stock: 25000, bond: null }, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } }));
    expect(!r.ok && r.code).toBe('MISSING_PRICE');
    expect(!r.ok && r.message).toContain('채권');
  });

  it('음수 납입금은 거부한다', () => {
    const r = calculatePlan(base({ additionalCash: -1, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } }));
    expect(!r.ok && r.code).toBe('INVALID_INPUT');
  });
});

describe('현금 우선형', () => {
  it('현금만 있는 경우: 시드머니 1,000만원을 목표 비중대로 정수 주 매수', () => {
    const input = base({ state: { shares: { stock: 0, bond: 0 }, cash: 10_000_000 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.lines.stock.action).toBe('buy');
    expect(plan.lines.bond.action).toBe('buy');
    // 목표: 주식 600만(240주), 채권 300만(250주), 현금 100만
    expect(plan.lines.stock.quantity).toBe(240);
    expect(plan.lines.bond.quantity).toBe(250);
    expect(plan.cashAfter.toNumber()).toBe(1_000_000);
    expect(plan.maxAbsDiffAfter.isZero()).toBe(true);
  });

  it('주식만 있는 경우: 매도하지 않고, 목표를 맞출 수 없다고 안내', () => {
    const input = base({ state: { shares: { stock: 400, bond: 0 }, cash: 0 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.hasTrades).toBe(false);
    expect(plan.notes.join(' ')).toContain('매도 없이 현금과 납입금만으로는 목표 비중을 맞출 수 없습니다');
  });

  it('채권만 있는 경우 + 추가 납입: 납입금으로 주식을 매수', () => {
    const input = base({ state: { shares: { stock: 0, bond: 500 }, cash: 0 }, additionalCash: 3_000_000 });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.lines.stock.action).toBe('buy');
    expect(plan.lines.bond.action).toBe('hold');
    expect(plan.lines.stock.quantity).toBe(120); // 300만원 ÷ 25,000
  });

  it('세 자산 모두 보유 + 50만원 납입: 부족한 자산부터 매수', () => {
    // 주식 240주(600만), 채권 200주(240만), 현금 100만 → 총 940만 + 50만 = 990만
    const input = base({ state: { shares: { stock: 240, bond: 200 }, cash: 1_000_000 }, additionalCash: 500_000 });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.totalBefore.toNumber()).toBe(9_900_000);
    expect(plan.lines.bond.action).toBe('buy');
    expect(plan.lines.stock.action).not.toBe('sell');
    expect(plan.lines.bond.diffAfter!.abs().lt(plan.lines.bond.diffBefore!.abs())).toBe(true);
  });

  it('추가 납입금이 1주 가격보다 작으면 매수하지 않고 안내', () => {
    // 이미 목표 비중대로 보유한 상태에서 소액 납입
    const input = base({ state: { shares: { stock: 240, bond: 250 }, cash: 1_000_000 }, additionalCash: 5_000 });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.hasTrades).toBe(false);
    expect(plan.notes.join(' ')).toContain('1주 가격');
    expect(plan.cashAfter.toNumber()).toBe(1_005_000);
  });

  it('추가 납입금으로 목표 비중을 맞출 수 없는 경우를 안내', () => {
    // 주식 비중이 매우 높고 납입금은 적다
    const input = base({ state: { shares: { stock: 400, bond: 0 }, cash: 0 }, additionalCash: 500_000 });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.lines.bond.action).toBe('buy');
    expect(plan.lines.stock.action).toBe('hold');
    expect(plan.withinToleranceAfter).toBe(false);
    expect(plan.notes.join(' ')).toContain('다음 리밸런싱 때 매도를 포함한 조정');
  });

  it('정수 주 때문에 목표를 정확히 맞출 수 없으면 오차를 표시', () => {
    const input = base({ prices: { stock: 33333, bond: 17777 }, state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.maxAbsDiffAfter.gt(0)).toBe(true);
    expect(plan.notes.join(' ')).toContain('1주 단위로만 거래');
  });

  it('거래 비용이 있으면 수수료를 반영하고 현금이 음수가 되지 않는다', () => {
    const input = base({
      targets: { stock: 70, bond: 30, cash: 0 },
      costs: { feeRatePct: 0.015, taxRatePct: 0 },
      state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 },
    });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.totalFees.gt(0)).toBe(true);
    // 수수료 = 원 단위 올림
    const stockFee = d(plan.lines.stock.tradeAmount).mul('0.00015').ceil();
    expect(plan.lines.stock.fee.eq(stockFee)).toBe(true);
  });

  it('큰 금액(100억원)도 정확하게 계산', () => {
    const input = base({ state: { shares: { stock: 0, bond: 0 }, cash: 10_000_000_000 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.lines.stock.quantity).toBe(240_000);
    expect(plan.lines.bond.quantity).toBe(250_000);
  });

  it('작은 금액(1만원)은 매수 없이 현금으로 둔다', () => {
    const input = base({ state: { shares: { stock: 0, bond: 0 }, cash: 10_000 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.hasTrades).toBe(false);
    expect(plan.cashAfter.toNumber()).toBe(10_000);
  });

  it('소수점 원 단위 현금도 처리한다', () => {
    const input = base({ state: { shares: { stock: 0, bond: 0 }, cash: '1000000.55' } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.cashAfter.toString().endsWith('.55')).toBe(true);
  });

  it('같은 입력이면 같은 결과 (재현 가능)', () => {
    const input = base({ state: { shares: { stock: 13, bond: 7 }, cash: 777_777 }, additionalCash: 123_456 });
    const a = ok(calculatePlan(input));
    const b = ok(calculatePlan(input));
    expect(a.lines.stock.quantity).toBe(b.lines.stock.quantity);
    expect(a.lines.bond.quantity).toBe(b.lines.bond.quantity);
    expect(a.cashAfter.eq(b.cashAfter)).toBe(true);
  });

  it('계산 과정(중간값)을 제공한다', () => {
    const plan = ok(calculatePlan(base({ state: { shares: { stock: 0, bond: 0 }, cash: 1_000_000 } })));
    expect(plan.steps.length).toBeGreaterThanOrEqual(5);
    expect(plan.steps[2].label).toContain('목표 금액');
  });
});

describe('매매형', () => {
  it('주식만 있는 경우: 주식을 매도하고 채권을 매수', () => {
    const input = base({ mode: 'full', state: { shares: { stock: 400, bond: 0 }, cash: 0 } });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    expect(plan.lines.stock.action).toBe('sell');
    expect(plan.lines.bond.action).toBe('buy');
    expect(plan.withinToleranceAfter).toBe(true);
  });

  it('매도 차익에 세금을 추정해 반영', () => {
    const input = base({
      mode: 'full',
      costs: { feeRatePct: 0, taxRatePct: 15.4 },
      state: { shares: { stock: 400, bond: 0 }, cash: 0, avgPrice: { stock: 20000 } },
    });
    const plan = ok(calculatePlan(input));
    checkInvariants(plan, input);
    const q = plan.lines.stock.quantity;
    expect(plan.lines.stock.tax.eq(d(5000).mul(q).mul('0.154').ceil())).toBe(true);
    expect(plan.notes.join(' ')).toContain('과세 추정액');
  });

  it('손실 중인 자산은 매도 세금이 0원', () => {
    const input = base({
      mode: 'full',
      costs: { feeRatePct: 0, taxRatePct: 15.4 },
      state: { shares: { stock: 400, bond: 0 }, cash: 0, avgPrice: { stock: 30000 } },
    });
    const plan = ok(calculatePlan(input));
    expect(plan.lines.stock.tax.isZero()).toBe(true);
  });

  it('비중이 이미 맞으면 거래하지 않는다', () => {
    const input = base({ mode: 'full', state: { shares: { stock: 240, bond: 250 }, cash: 1_000_000 } });
    const plan = ok(calculatePlan(input));
    expect(plan.hasTrades).toBe(false);
    expect(plan.withinToleranceBefore).toBe(true);
  });
});
