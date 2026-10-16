import type { MarketFile, SeriesPoint } from './marketTypes';
import { addDays, isBusinessDay, todayKst } from '../engine/schedule';

/**
 * Mock(가상) 데이터: 화면·계산 검증용. 실제 가격이 아님을 화면에 항상 표시한다.
 * 같은 날에는 항상 같은 값이 나오도록 고정 시드 난수를 쓴다.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function normal(r: () => number) {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function walk(dates: string[], start: number, drift: number, vol: number, seed: number, decimals = 0): SeriesPoint[] {
  const r = rng(seed);
  let p = start;
  const f = 10 ** decimals;
  return dates.map((date) => {
    p *= 1 + drift / 252 + (vol / Math.sqrt(252)) * normal(r);
    return { date, close: Math.round(p * f) / f };
  });
}

export function buildMockMarket(codes: { stock: string; bond: string; stockName: string; bondName: string }, today = todayKst()): MarketFile {
  const dates: string[] = [];
  let cur = addDays(today, -365 * 3);
  while (cur < today) {
    if (isBusinessDay(cur)) dates.push(cur);
    cur = addDays(cur, 1);
  }
  const now = new Date().toISOString();
  const mk = (id: string, name: string, unit: string, history: SeriesPoint[]) => ({
    id, name, unit, source: 'Mock (가상 데이터)', history, lastSuccessAt: now, error: null,
  });
  return {
    schemaVersion: 1,
    generatedAt: now,
    isMock: true,
    delayNote: '가상(Mock) 데이터입니다. 실제 가격이 아닙니다.',
    series: {
      [codes.stock]: mk(codes.stock, codes.stockName, '원/주', walk(dates, 15000, 0.12, 0.17, 11)),
      [codes.bond]: mk(codes.bond, codes.bondName, '원/주', walk(dates, 12500, 0.01, 0.09, 23)),
      USDKRW: mk('USDKRW', 'USD/KRW 환율', '원/달러', walk(dates, 1300, 0.02, 0.07, 37, 2)),
    },
    distributions: [],
  };
}
