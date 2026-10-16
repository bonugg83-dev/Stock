/**
 * 통계·CAPM·참고 비중 계산 (참고용)
 *
 * 과거 데이터로 계산한 값은 미래 수익을 보장하지 않는다.
 * 통계는 소수(float)로 계산한다 (금액 계산과 달리 원 단위 정확도가 필요 없음).
 */

export const TRADING_DAYS = 252;

export interface PricePoint {
  date: string;
  close: number;
}

/** 두 시계열에서 날짜가 겹치는 값만 남긴다 */
export function alignSeries(a: PricePoint[], b: PricePoint[]): { dates: string[]; a: number[]; b: number[] } {
  const mb = new Map(b.map((p) => [p.date, p.close]));
  const out = { dates: [] as string[], a: [] as number[], b: [] as number[] };
  for (const p of [...a].sort((x, y) => x.date.localeCompare(y.date))) {
    const v = mb.get(p.date);
    if (v !== undefined && p.close > 0 && v > 0) {
      out.dates.push(p.date);
      out.a.push(p.close);
      out.b.push(v);
    }
  }
  return out;
}

export function dailyReturns(closes: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}

export const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);

export function stdev(x: number[]): number {
  if (x.length < 2) return NaN;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
}

export function covariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (x.length - 1);
}

export const correlation = (x: number[], y: number[]) => covariance(x, y) / (stdev(x) * stdev(y));

/** 연 환산 변동성 */
export const annualVol = (r: number[]) => stdev(r) * Math.sqrt(TRADING_DAYS);

/** 연 환산 평균 수익률 (기하평균, CAGR) */
export function annualReturn(closes: number[]): number {
  if (closes.length < 2) return NaN;
  const years = (closes.length - 1) / TRADING_DAYS;
  return Math.pow(closes[closes.length - 1] / closes[0], 1 / years) - 1;
}

/** 베타 = Cov(자산, 시장) / Var(시장) */
export const beta = (asset: number[], market: number[]) => covariance(asset, market) / covariance(market, market);

/** 샤프지수 = (연 수익률 - 무위험수익률) / 연 변동성 */
export const sharpe = (annRet: number, annV: number, rf: number) => (annV > 0 ? (annRet - rf) / annV : NaN);

/** 최대 낙폭 (음수, -0.25 = -25%) */
export function maxDrawdown(closes: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, c / peak - 1);
  }
  return mdd;
}

/** CAPM 기대수익률 = 무위험수익률 + 베타 × (시장 기대수익률 - 무위험수익률) */
export const capmExpectedReturn = (rf: number, b: number, marketReturn: number) => rf + b * (marketReturn - rf);

export interface AssetStats {
  annualReturn: number;
  annualVol: number;
  sharpe: number;
  maxDrawdown: number;
  beta: number;
  capmExpected: number;
}

export interface PairStats {
  observations: number;
  years: number;
  startDate: string | null;
  endDate: string | null;
  correlation: number;
  stock: AssetStats;
  bond: AssetStats;
  warnings: string[];
}

/** 주식을 시장 대표(시장 포트폴리오 대용)로 보고 두 자산 통계를 계산 */
export function computePairStats(stock: PricePoint[], bond: PricePoint[], rf: number): PairStats | null {
  const al = alignSeries(stock, bond);
  if (al.a.length < 3) return null;
  const rs = dailyReturns(al.a);
  const rb = dailyReturns(al.b);
  const years = rs.length / TRADING_DAYS;
  const mk = (closes: number[], r: number[]): AssetStats => {
    const ar = annualReturn(closes);
    const av = annualVol(r);
    const b = beta(r, rs);
    return { annualReturn: ar, annualVol: av, sharpe: sharpe(ar, av, rf), maxDrawdown: maxDrawdown(closes), beta: b, capmExpected: capmExpectedReturn(rf, b, annualReturn(al.a)) };
  };
  const warnings: string[] = [];
  if (years < 3) warnings.push(`데이터 기간이 약 ${years.toFixed(1)}년으로 짧아 통계 결과를 신뢰하기 어렵습니다.`);
  else if (years < 10) warnings.push(`데이터 기간이 약 ${years.toFixed(1)}년입니다. 금리·경기 사이클 전체를 담기에는 짧을 수 있습니다.`);
  return {
    observations: rs.length,
    years,
    startDate: al.dates[0] ?? null,
    endDate: al.dates[al.dates.length - 1] ?? null,
    correlation: correlation(rs, rb),
    stock: mk(al.a, rs),
    bond: mk(al.b, rb),
    warnings,
  };
}

export interface ReferenceWeights {
  key: 'inverseVol' | 'minVariance' | 'maxSharpe';
  name: string;
  description: string;
  /** % 단위, 합계 100 */
  stock: number;
  bond: number;
  cash: number;
  expectedReturn: number;
  expectedVol: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 두 위험자산 포트폴리오의 연 기대수익률·변동성 (현금은 무위험수익률, 변동성 0) */
export function portfolioMetrics(ws: number, wb: number, wc: number, s: PairStats, rf: number) {
  const er = ws * s.stock.annualReturn + wb * s.bond.annualReturn + wc * rf;
  const vs = s.stock.annualVol;
  const vb = s.bond.annualVol;
  const variance = ws * ws * vs * vs + wb * wb * vb * vb + 2 * ws * wb * s.correlation * vs * vb;
  return { expectedReturn: er, expectedVol: Math.sqrt(Math.max(0, variance)) };
}

/**
 * 참고 비중: 사용자가 정한 현금 비중은 그대로 두고, 나머지(위험자산 몫)를 주식·채권에 나눈다.
 * 공매도·레버리지는 허용하지 않는다(0~100%).
 */
export function referenceWeights(s: PairStats, rf: number, cashPct: number): ReferenceWeights[] {
  const risky = (100 - cashPct) / 100;
  const vs = s.stock.annualVol;
  const vb = s.bond.annualVol;
  const cov = s.correlation * vs * vb;
  const out: ReferenceWeights[] = [];
  const push = (key: ReferenceWeights['key'], name: string, description: string, stockShareOfRisky: number) => {
    const x = clamp01(stockShareOfRisky);
    const ws = x * risky;
    const wb = (1 - x) * risky;
    const wc = cashPct / 100;
    const m = portfolioMetrics(ws, wb, wc, s, rf);
    out.push({
      key,
      name,
      description,
      stock: Math.round(ws * 1000) / 10,
      bond: Math.round(wb * 1000) / 10,
      cash: Math.round((100 - Math.round(ws * 1000) / 10 - Math.round(wb * 1000) / 10) * 10) / 10,
      ...m,
    });
  };

  if (vs > 0 && vb > 0) {
    push('inverseVol', '위험 균형 (역변동성)', '덜 흔들리는 자산에 더 많이 배분합니다.', (1 / vs) / (1 / vs + 1 / vb));
    const denom = vs * vs + vb * vb - 2 * cov;
    if (denom > 0) push('minVariance', '최소 분산', '과거 데이터 기준으로 전체 흔들림이 가장 작았던 조합입니다.', (vb * vb - cov) / denom);
    const es = s.stock.annualReturn - rf;
    const eb = s.bond.annualReturn - rf;
    const num = es * vb * vb - eb * cov;
    const den = es * vb * vb + eb * vs * vs - (es + eb) * cov;
    // 두 자산 모두 초과수익이 0 이하이면 "최대 샤프"는 의미가 없으므로 생략
    if ((es > 0 || eb > 0) && den !== 0 && Number.isFinite(num / den)) {
      push('maxSharpe', '최대 샤프 (평균-분산)', '과거에 위험 1단위당 초과수익이 가장 컸던 조합입니다. 과거 수익률에 가장 민감합니다.', num / den);
    }
  }
  return out;
}
