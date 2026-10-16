import { d, type Dec, type MoneyInput } from './money';

/**
 * 수익률 계산
 *
 * - 단순 누적 수익률: (현재 평가금액 - 순납입원금) ÷ 순납입원금
 *   → 언제 돈을 넣었는지는 고려하지 않는다.
 * - XIRR(돈 가중 수익률): 돈을 넣은 날짜와 금액까지 반영한 "연 환산" 수익률
 *   → 내 계좌가 실제로 1년에 몇 % 불어났는지에 가깝다.
 * - 시간가중수익률(TWR): 납입 시점·금액의 영향을 제거한 운용 성과
 *   → 같은 규칙을 따른 포트폴리오 자체의 성과를 비교할 때 쓴다.
 */

export function simpleReturnPct(currentValue: MoneyInput, netContribution: MoneyInput): Dec | null {
  const c = d(netContribution);
  if (c.lte(0)) return null;
  return d(currentValue).sub(c).div(c).mul(100);
}

export interface CashFlow {
  /** YYYY-MM-DD */
  date: string;
  /** 투자자 입장: 납입은 음수(-), 출금·현재 평가금액은 양수(+) */
  amount: number;
}

const dayMs = 24 * 60 * 60 * 1000;
const toTime = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** XIRR: 연 환산 수익률 (소수, 0.07 = 7%). 계산 불가 시 null */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows.filter((f) => f.amount !== 0);
  if (fs.length < 2) return null;
  if (!fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...fs.map((f) => toTime(f.date)));
  const years = fs.map((f) => (toTime(f.date) - t0) / dayMs / 365);
  if (Math.max(...years) <= 0) return null;
  const npv = (r: number) => fs.reduce((acc, f, i) => acc + f.amount / Math.pow(1 + r, years[i]), 0);

  // 이분법 (안정적)
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

export interface TwrPeriod {
  /** 구간 시작 평가금액 (직전 현금흐름 반영 직후) */
  startValue: number;
  /** 구간 끝 평가금액 (다음 현금흐름 반영 직전) */
  endValue: number;
}

/** 시간가중수익률 (소수). 구간별 수익률을 곱해 연결한다 */
export function twr(periods: TwrPeriod[]): number | null {
  const valid = periods.filter((p) => p.startValue > 0);
  if (!valid.length) return null;
  return valid.reduce((acc, p) => acc * (p.endValue / p.startValue), 1) - 1;
}

/** 자산별 수익률 = (평가금액 - 매입원가) ÷ 매입원가 */
export function assetReturnPct(value: MoneyInput, costBasis: MoneyInput): Dec | null {
  return simpleReturnPct(value, costBasis);
}
