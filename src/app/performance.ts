import type { CashLedgerEntry } from '../db/schema';
import type { SeriesPoint } from '../data/marketTypes';
import { xirr, twr, type CashFlow, type TwrPeriod } from '../engine/returns';
import type { RiskyAsset } from '../engine/types';

/** 해당 날짜(포함) 이전의 마지막 종가 */
export function closeOnOrBefore(history: SeriesPoint[], date: string): number | null {
  let lo = 0;
  let hi = history.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= date) {
      ans = history[mid].close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

interface Replay {
  date: string;
  shares: Record<RiskyAsset, number>;
  cash: number;
}

/**
 * 장부를 날짜순으로 재생하여 납입·출금 시점마다 포트폴리오 가치를 계산하고
 * XIRR(돈 가중)과 TWR(시간 가중)을 구한다. 가격 이력이 부족하면 null.
 */
export function computePerformance(
  ledger: CashLedgerEntry[],
  history: Record<RiskyAsset, SeriesPoint[]>,
  today: string,
  currentValue: number,
): { xirr: number | null; twr: number | null } {
  const entries = [...ledger].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
  const flows: CashFlow[] = [];
  const periods: TwrPeriod[] = [];
  const state: Replay = { date: '', shares: { stock: 0, bond: 0 }, cash: 0 };

  const valueAt = (date: string): number | null => {
    let v = state.cash;
    for (const a of ['stock', 'bond'] as RiskyAsset[]) {
      if (state.shares[a] === 0) continue;
      const p = closeOnOrBefore(history[a], date);
      if (p === null) return null;
      v += p * state.shares[a];
    }
    return v;
  };

  let periodStart: number | null = null;
  let twrOk = true;
  for (const e of entries) {
    const external = e.type === 'deposit' || e.type === 'withdraw';
    if (external) {
      const before = valueAt(e.date);
      if (periodStart !== null) {
        if (before === null) twrOk = false;
        else periods.push({ startValue: periodStart, endValue: before });
      }
      flows.push({ date: e.date, amount: -e.amount });
    }
    state.cash += e.amount;
    if (e.asset && e.shares) {
      if (e.type === 'buy') state.shares[e.asset] += e.shares;
      if (e.type === 'sell') state.shares[e.asset] -= e.shares;
    }
    if (external) periodStart = valueAt(e.date);
  }
  if (periodStart !== null) periods.push({ startValue: periodStart, endValue: currentValue });
  flows.push({ date: today, amount: currentValue });
  return { xirr: xirr(flows), twr: twrOk ? twr(periods) : null };
}
