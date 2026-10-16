import { d, HUNDRED } from './money';
import type { Weights } from './types';

export interface WeightCheck {
  ok: boolean;
  sum: number;
  errors: string[];
}

/** 비중 검증: 자동 보정하지 않고, 부족·초과분을 알려준다 */
export function validateWeights(w: Weights): WeightCheck {
  const errors: string[] = [];
  const values = [w.stock, w.bond, w.cash];
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return { ok: false, sum: NaN, errors: ['모든 비중을 숫자로 입력해주세요.'] };
  }
  if (values.some((v) => v < 0)) errors.push('비중은 0% 이상이어야 합니다.');
  const sum = values.reduce((acc, v) => acc.add(d(v)), d(0));
  if (sum.isZero()) {
    errors.push('모든 비중이 0%입니다. 최소 한 자산에 비중을 지정해주세요.');
  } else if (!sum.eq(HUNDRED)) {
    const diff = HUNDRED.sub(sum);
    errors.push(
      diff.gt(0)
        ? `비중 합계가 ${sum.toString()}%입니다. 100%까지 ${diff.toString()}%p 부족합니다.`
        : `비중 합계가 ${sum.toString()}%입니다. 100%를 ${diff.neg().toString()}%p 초과했습니다.`,
    );
  }
  return { ok: errors.length === 0, sum: sum.toNumber(), errors };
}

export const isValidDateString = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
};

export interface OnboardingInput {
  seedMoney: number;
  startDate: string;
  weights: Weights;
  shares: { stock: number; bond: number };
  cash: number;
  rebalanceMonths: number[];
  notifyTime: string;
}

export type FieldErrors = Partial<Record<string, string>>;

export function validateOnboarding(input: OnboardingInput): FieldErrors {
  const e: FieldErrors = {};
  if (!Number.isFinite(input.seedMoney) || input.seedMoney <= 0) {
    e.seedMoney = '초기 시드머니는 0원보다 커야 합니다.';
  }
  if (!input.startDate || !isValidDateString(input.startDate)) {
    e.startDate = '올바른 날짜를 입력해주세요.';
  }
  const wc = validateWeights(input.weights);
  if (!wc.ok) e.weights = wc.errors.join(' ');
  for (const k of ['stock', 'bond'] as const) {
    const n = input.shares[k];
    if (!Number.isInteger(n) || n < 0) e[`shares.${k}`] = '보유 수량은 0 이상의 정수여야 합니다.';
  }
  if (!Number.isFinite(input.cash) || input.cash < 0) e.cash = '현금은 0원 이상이어야 합니다.';
  if (
    input.rebalanceMonths.length === 0 ||
    input.rebalanceMonths.some((m) => !Number.isInteger(m) || m < 1 || m > 12)
  ) {
    e.rebalanceMonths = '리밸런싱 월을 1개 이상 선택해주세요.';
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.notifyTime)) e.notifyTime = '알림 시간을 HH:MM 형식으로 입력해주세요.';
  return e;
}

export function validateDepositAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return '금액을 숫자로 입력해주세요.';
  if (amount < 0) return '추가 납입금은 0원 이상이어야 합니다.';
  return null;
}
