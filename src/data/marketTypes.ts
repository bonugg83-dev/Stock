/**
 * 가격 데이터 파일 형식 (public/data/market.json)
 * GitHub Actions 수집기(scripts/)가 만들고, 웹앱이 읽는다.
 */

export interface SeriesPoint {
  /** YYYY-MM-DD (한국 날짜) */
  date: string;
  /** 종가 (ETF: 원/주, 환율: 원/달러) */
  close: number;
}

export interface Series {
  id: string;
  name: string;
  unit: string;
  source: string;
  /** 날짜 오름차순 */
  history: SeriesPoint[];
  /** 마지막으로 수집에 성공한 시각 (ISO) */
  lastSuccessAt: string | null;
  /** 이번 수집에서 발생한 오류 (성공 시 null) */
  error: string | null;
}

export interface DistributionInfo {
  code: string;
  /** 분배 기준일 */
  recordDate: string;
  /** 지급일 */
  payDate: string | null;
  /** 주당 분배금 (원, 세전) */
  perShare: number;
  source: string;
}

export interface MarketFile {
  schemaVersion: 1;
  generatedAt: string;
  isMock: boolean;
  /** 지연 여부 안내 문구 */
  delayNote: string;
  /** key: ETF 종목코드(6자리) 또는 'USDKRW' */
  series: Record<string, Series>;
  distributions: DistributionInfo[];
}

export interface Quote {
  id: string;
  name: string;
  unit: string;
  source: string;
  date: string;
  close: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
}

export function latestQuote(s: Series | undefined): Quote | null {
  if (!s || s.history.length === 0) return null;
  const last = s.history[s.history.length - 1];
  const prev = s.history.length > 1 ? s.history[s.history.length - 2] : null;
  return {
    id: s.id,
    name: s.name,
    unit: s.unit,
    source: s.source,
    date: last.date,
    close: last.close,
    prevClose: prev?.close ?? null,
    change: prev ? last.close - prev.close : null,
    changePct: prev && prev.close ? (last.close / prev.close - 1) * 100 : null,
  };
}

export const FX_ID = 'USDKRW';
