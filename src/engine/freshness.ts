import { businessDaysBetween } from './schedule';

export type Freshness = 'fresh' | 'stale' | 'missing';

/**
 * 가격 데이터 신선도
 *
 * 공식 일별 시세는 보통 다음 영업일에 공개되므로(전 거래일 종가),
 * 마지막 가격 날짜와 오늘 사이 영업일이 staleAfterBusinessDays 보다 크면 "오래됨"으로 본다.
 */
export function evaluateFreshness(lastPriceDate: string | null | undefined, today: string, staleAfterBusinessDays = 2): Freshness {
  if (!lastPriceDate) return 'missing';
  return businessDaysBetween(lastPriceDate, today) > staleAfterBusinessDays ? 'stale' : 'fresh';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: '정상 (전 거래일 종가 기준)',
  stale: '최신 데이터가 아닐 수 있음',
  missing: '데이터 없음',
};
