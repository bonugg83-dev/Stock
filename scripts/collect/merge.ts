import type { MarketFile, Series, SeriesPoint } from '../../src/data/marketTypes.ts';

/** 같은 날짜는 새 값으로 덮어쓰고 날짜순 정렬 */
export function mergeHistory(oldPts: SeriesPoint[], newPts: SeriesPoint[]): SeriesPoint[] {
  const m = new Map<string, number>();
  for (const p of oldPts) m.set(p.date, p.close);
  for (const p of newPts) m.set(p.date, p.close);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close }));
}

export interface SeriesUpdate {
  id: string;
  name: string;
  unit: string;
  source: string;
  result: { ok: true; points: SeriesPoint[] } | { ok: false; error: string };
}

/**
 * 이전 파일과 이번 수집 결과를 합친다.
 * 수집에 실패한 시리즈는 이전 데이터를 그대로 두고 error만 기록한다
 * (앱은 마지막 성공 데이터와 그 시각을 보여준다).
 */
export function buildMarketFile(prev: MarketFile | null, updates: SeriesUpdate[], nowIso: string): MarketFile {
  const series: Record<string, Series> = {};
  for (const u of updates) {
    const old = prev && !prev.isMock ? prev.series[u.id] : undefined;
    if (u.result.ok) {
      series[u.id] = {
        id: u.id,
        name: u.name,
        unit: u.unit,
        source: u.source,
        history: mergeHistory(old?.history ?? [], u.result.points),
        lastSuccessAt: u.result.points.length ? nowIso : (old?.lastSuccessAt ?? null),
        error: u.result.points.length ? null : '새로 받은 데이터가 없습니다 (휴장일이거나 아직 공개 전일 수 있음)',
      };
    } else {
      series[u.id] = {
        id: u.id,
        name: u.name,
        unit: u.unit,
        source: u.source,
        history: old?.history ?? [],
        lastSuccessAt: old?.lastSuccessAt ?? null,
        error: u.result.error,
      };
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    isMock: false,
    delayNote: 'ETF 가격은 전 거래일 종가, 환율은 ECB 기준환율(영업일 1회)입니다. 실시간 가격이 아닙니다.',
    series,
    distributions: prev && !prev.isMock ? prev.distributions : [],
  };
}
