/**
 * 날짜·일정 계산 (모든 날짜는 한국 시간 기준 YYYY-MM-DD 문자열)
 *
 * "첫 거래일"은 주말과 양력 고정 공휴일만 제외해 근사한다.
 * 설·추석 등 음력 공휴일과 대체공휴일은 반영하지 않으므로 화면에 안내한다.
 */

const FIXED_HOLIDAYS = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25', '12-31'];

export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, dd: number) => `${y}-${pad(m)}-${pad(dd)}`;

/** 현재 한국 날짜 */
export function todayKst(now: Date = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return ymd(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate());
}

const parse = (s: string) => {
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
};
const fmt = (dt: Date) => ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());

export function addDays(s: string, n: number): string {
  const dt = parse(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmt(dt);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}

export function isBusinessDay(s: string, extraHolidays: string[] = []): boolean {
  const dow = parse(s).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (FIXED_HOLIDAYS.includes(s.slice(5))) return false;
  return !extraHolidays.includes(s);
}

/** from 다음 날부터 to까지의 영업일 수 */
export function businessDaysBetween(from: string, to: string, extraHolidays: string[] = []): number {
  if (to <= from) return 0;
  let n = 0;
  for (let cur = addDays(from, 1); cur <= to; cur = addDays(cur, 1)) if (isBusinessDay(cur, extraHolidays)) n++;
  return n;
}

export function firstTradingDay(year: number, month: number, extraHolidays: string[] = []): string {
  let cur = ymd(year, month, 1);
  while (!isBusinessDay(cur, extraHolidays)) cur = addDays(cur, 1);
  return cur;
}

export type RebalanceSchedule =
  | { type: 'firstTradingDay'; months: number[] }
  | { type: 'custom'; dates: string[] /* MM-DD */ };

/** 오늘(포함) 이후의 다음 리밸런싱 예정일 */
export function nextRebalanceDate(today: string, schedule: RebalanceSchedule, extraHolidays: string[] = []): string {
  const year = Number(today.slice(0, 4));
  const candidates: string[] = [];
  for (const y of [year, year + 1]) {
    if (schedule.type === 'firstTradingDay') {
      for (const m of schedule.months) candidates.push(firstTradingDay(y, m, extraHolidays));
    } else {
      for (const md of schedule.dates) candidates.push(`${y}-${md}`);
    }
  }
  return candidates.filter((c) => c >= today).sort()[0];
}

/** 직전 리밸런싱 예정일 (오늘 이전, 없으면 null) */
export function previousRebalanceDate(today: string, schedule: RebalanceSchedule, extraHolidays: string[] = []): string | null {
  const year = Number(today.slice(0, 4));
  const candidates: string[] = [];
  for (const y of [year - 1, year]) {
    if (schedule.type === 'firstTradingDay') {
      for (const m of schedule.months) candidates.push(firstTradingDay(y, m, extraHolidays));
    } else {
      for (const md of schedule.dates) candidates.push(`${y}-${md}`);
    }
  }
  const past = candidates.filter((c) => c < today).sort();
  return past.length ? past[past.length - 1] : null;
}
