import { describe, expect, it } from 'vitest';
import { d } from './money';
import { valuePortfolio, MissingPriceError, usdExposurePct } from './portfolio';
import { validateWeights, validateOnboarding, isValidDateString } from './validation';
import { simpleReturnPct, xirr, twr } from './returns';
import { nextRebalanceDate, firstTradingDay, businessDaysBetween, todayKst } from './schedule';
import { evaluateFreshness } from './freshness';
import { buildNotices } from './notifications';
import { computePairStats, maxDrawdown, referenceWeights, type PricePoint } from './stats';

describe('평가금액과 비중', () => {
  it('자산 평가금액 = 수량 × 가격, 비중 합계 100', () => {
    const v = valuePortfolio({ shares: { stock: 10, bond: 20 }, cash: 50_000 }, { stock: 25000, bond: 12000 });
    expect(v.values.stock.toNumber()).toBe(250_000);
    expect(v.values.bond.toNumber()).toBe(240_000);
    expect(v.total.toNumber()).toBe(540_000);
    expect(v.weights.stock!.add(v.weights.bond!).add(v.weights.cash!).eq(100)).toBe(true);
    expect(usdExposurePct(v, { stock: true, bond: true })!.toFixed(2)).toBe('90.74');
  });
  it('전체가 0이면 비중은 null (0을 지어내지 않음)', () => {
    const v = valuePortfolio({ shares: { stock: 0, bond: 0 }, cash: 0 }, { stock: 25000, bond: 12000 });
    expect(v.weights.stock).toBeNull();
  });
  it('가격이 없으면 예외', () => {
    expect(() => valuePortfolio({ shares: { stock: 1, bond: 0 }, cash: 0 }, { stock: null, bond: 1 })).toThrow(MissingPriceError);
  });
});

describe('검증', () => {
  it('정상 비중', () => expect(validateWeights({ stock: 60, bond: 30, cash: 10 }).ok).toBe(true));
  it('소수 비중 합계도 정확히 비교 (0.1+0.2 문제 없음)', () =>
    expect(validateWeights({ stock: 59.9, bond: 30.1, cash: 10 }).ok).toBe(true));
  it('음수 비중 거부', () => expect(validateWeights({ stock: 110, bond: -10, cash: 0 }).ok).toBe(false));
  it('날짜 검증', () => {
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
  });
  it('온보딩: 시드머니 0 거부', () => {
    const e = validateOnboarding({
      seedMoney: 0, startDate: '2026-10-16', weights: { stock: 60, bond: 30, cash: 10 },
      shares: { stock: 0, bond: 0 }, cash: 0, rebalanceMonths: [1, 4, 7, 10], notifyTime: '09:00',
    });
    expect(e.seedMoney).toBeDefined();
  });
});

describe('수익률', () => {
  it('단순 수익률', () => expect(simpleReturnPct(11_000_000, 10_000_000)!.toNumber()).toBe(10));
  it('원금 0이면 null', () => expect(simpleReturnPct(100, 0)).toBeNull());
  it('XIRR: 1년 뒤 10% → 약 0.10', () => {
    const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
    expect(r!).toBeCloseTo(0.1, 3);
  });
  it('XIRR: 계산 불가하면 null', () => expect(xirr([{ date: '2025-01-01', amount: -1000 }])).toBeNull());
  it('TWR: 구간 수익률 연결', () => {
    expect(twr([{ startValue: 100, endValue: 110 }, { startValue: 210, endValue: 231 }])!).toBeCloseTo(0.21, 10);
  });
});

describe('일정', () => {
  it('첫 거래일: 주말·1월 1일 제외', () => {
    expect(firstTradingDay(2028, 1)).toBe('2028-01-03'); // 1/1 토
    expect(firstTradingDay(2026, 1)).toBe('2026-01-02'); // 1/1 목(공휴일)
  });
  it('다음 분기 리밸런싱일', () => {
    const s = { type: 'firstTradingDay' as const, months: [1, 4, 7, 10] };
    expect(nextRebalanceDate('2026-10-16', s)).toBe('2027-01-04'); // 2027-01-01 금(공휴일) → 주말 → 1/4 월
    expect(nextRebalanceDate('2026-07-01', s)).toBe('2026-07-01');
  });
  it('직접 지정한 날짜', () => {
    expect(nextRebalanceDate('2026-10-16', { type: 'custom', dates: ['03-15', '09-15'] })).toBe('2027-03-15');
  });
  it('영업일 수', () => expect(businessDaysBetween('2026-10-16', '2026-10-19')).toBe(1));
  it('한국 날짜', () => expect(todayKst(new Date('2026-10-15T20:00:00Z'))).toBe('2026-10-16'));
});

describe('데이터 신선도', () => {
  it('전 거래일 데이터는 정상', () => expect(evaluateFreshness('2026-10-15', '2026-10-16')).toBe('fresh'));
  it('오래된 데이터는 경고', () => expect(evaluateFreshness('2026-10-01', '2026-10-16')).toBe('stale'));
  it('데이터 없음', () => expect(evaluateFreshness(null, '2026-10-16')).toBe('missing'));
});

describe('알림', () => {
  const ctx = {
    today: '2026-10-16', nextRebalance: '2026-10-16', remindDaysBefore: 7, freshness: 'fresh' as const,
    lastPriceDate: '2026-10-15', dataError: null,
    actualWeights: { stock: d('62.4'), bond: d('28'), cash: d('9.6') },
    targetWeights: { stock: 60, bond: 30, cash: 10 }, tolerancePctPoint: 5, pendingDistributions: 0,
  };
  it('리밸런싱 당일 알림은 계산 결과 안내 문구', () => {
    const n = buildNotices(ctx);
    expect(n[0].body).toContain('주식 비중은 62.40%, 목표 비중은 60%');
    expect(n[0].body).not.toContain('매도하세요');
  });
  it('API 실패·오래된 데이터·허용 범위 이탈 알림', () => {
    const n = buildNotices({ ...ctx, nextRebalance: '2027-01-04', dataError: 'HTTP 500', freshness: 'stale', actualWeights: { stock: d(70), bond: d(20), cash: d(10) } });
    const keys = n.map((x) => x.key.split(':')[0]);
    expect(keys).toEqual(['data-error', 'data-stale', 'tolerance']);
  });
});

describe('통계', () => {
  const series = (start: number, rets: number[]): PricePoint[] => {
    let p = start;
    const out: PricePoint[] = [{ date: '2020-01-01', close: p }];
    rets.forEach((r, i) => {
      p *= 1 + r;
      out.push({ date: `2020-01-${String(i + 2).padStart(2, '0')}`, close: p });
    });
    return out;
  };
  it('최대 낙폭', () => expect(maxDrawdown([100, 120, 90, 130])).toBeCloseTo(-0.25));
  it('짧은 기간이면 경고 + 참고 비중 합계 100', () => {
    const s = computePairStats(series(100, [0.01, -0.02, 0.015, -0.005, 0.01]), series(50, [-0.002, 0.004, -0.001, 0.003, -0.002]), 0.03)!;
    expect(s.warnings[0]).toContain('짧아');
    expect(s.stock.beta).toBeCloseTo(1, 10);
    for (const w of referenceWeights(s, 0.03, 10)) {
      expect(w.stock + w.bond + w.cash).toBeCloseTo(100, 5);
      expect(w.cash).toBeCloseTo(10, 5);
      expect(w.stock).toBeGreaterThanOrEqual(0);
    }
  });
});
