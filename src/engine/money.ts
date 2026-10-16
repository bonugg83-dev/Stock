import Decimal from 'decimal.js';

/**
 * 금액 계산 규칙 (모든 금액 계산은 이 파일의 함수를 거친다)
 *
 * - 내부 계산은 십진수(Decimal)로 처리해 부동소수점 오차를 피한다.
 * - 현금은 소수점 원 단위까지 허용한다 (표시는 원 단위 반올림).
 * - 수수료·세금은 원 단위 "올림" (사용자에게 불리한 쪽으로 보수적으로 계산).
 * - 비중(%)은 계산 중에는 반올림하지 않고, 표시할 때만 소수 2자리로 반올림한다.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type MoneyInput = Decimal.Value;

export const d = (v: MoneyInput): Dec => new Dec(v);
export const ZERO = d(0);
export const HUNDRED = d(100);

/** 수수료·세금: 원 단위 올림 */
export const ceilWon = (v: MoneyInput): Dec => d(v).toDecimalPlaces(0, Decimal.ROUND_CEIL);
/** 표시용: 원 단위 반올림 */
export const roundWon = (v: MoneyInput): Dec => d(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

/** part / total × 100. total이 0이면 비중을 정의할 수 없으므로 null */
export const percentOf = (part: Dec, total: Dec): Dec | null =>
  total.isZero() ? null : part.div(total).mul(HUNDRED);

export const formatWon = (v: MoneyInput | null | undefined): string => {
  if (v === null || v === undefined) return '—';
  return `${roundWon(v).toNumber().toLocaleString('ko-KR')}원`;
};

export const formatPct = (v: MoneyInput | null | undefined, digits = 2): string => {
  if (v === null || v === undefined) return '—';
  return `${d(v).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed(digits)}%`;
};

export const formatPctPoint = (v: MoneyInput | null | undefined, digits = 2): string => {
  if (v === null || v === undefined) return '—';
  const x = d(v).toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
  return `${x.gt(0) ? '+' : ''}${x.toFixed(digits)}%p`;
};
