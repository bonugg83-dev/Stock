import { useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppData } from '../../app/AppData';
import { updateSettings } from '../../db/repo';
import { addDays } from '../../engine/schedule';
import { computePairStats, portfolioMetrics, referenceWeights, type ReferenceWeights } from '../../engine/stats';
import type { SeriesPoint } from '../../data/marketTypes';
import { Button, Card, Disclaimer, Modal, Notice, Term, cx } from '../components/ui';

const RANGES = [
  { key: '1M', days: 31 },
  { key: '3M', days: 92 },
  { key: '1Y', days: 366 },
  { key: '전체', days: 100000 },
] as const;

const pct = (x: number | undefined, digits = 1) => (x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`);
const num = (x: number | undefined, digits = 2) => (x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(digits));

export default function Analysis() {
  const app = useAppData();
  const s = app.settings!;
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('1Y');
  const [apply, setApply] = useState<ReferenceWeights | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const rf = s.riskFreeRatePct / 100;

  const stats = useMemo(() => computePairStats(app.history.stock, app.history.bond, rf), [app.history, rf]);
  const refs = useMemo(() => (stats ? referenceWeights(stats, rf, s.targets.cash) : []), [stats, rf, s.targets.cash]);
  const mine = stats ? portfolioMetrics(s.targets.stock / 100, s.targets.bond / 100, s.targets.cash / 100, stats, rf) : null;

  const cut = (h: SeriesPoint[]) => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const from = addDays(app.today, -days);
    return h.filter((p) => p.date >= from);
  };

  const doApply = async () => {
    if (!apply) return;
    await updateSettings({ targets: { stock: apply.stock, bond: apply.bond, cash: apply.cash } }, `목표 비중 변경: ${apply.name} 참고 비중 적용`);
    setMsg(`목표 비중을 주식 ${apply.stock}% · 채권 ${apply.bond}% · 현금 ${apply.cash}%로 변경했습니다. 변경 이력은 기록 화면에 남습니다.`);
    setApply(null);
  };

  return (
    <div className="space-y-4">
      <Card
        title="가격 차트"
        actions={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)} className={cx('rounded-md px-2 py-1 text-xs', range === r.key ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800')}>
                {r.key}
              </button>
            ))}
          </div>
        }
      >
        <p className="mb-2 text-xs text-slate-500">일별 종가 데이터만 제공되어 하루 안의(1일) 차트는 없습니다. 전일 대비 변화는 대시보드에서 확인하세요.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <MiniChart title={`${s.assets.stock.name} (원)`} data={cut(app.history.stock)} color="var(--color-stock)" />
          <MiniChart title={`${s.assets.bond.name} (원)`} data={cut(app.history.bond)} color="var(--color-bond)" />
          <MiniChart title="USD/KRW (원/달러)" data={cut(app.history.fx)} color="#7c3aed" />
        </div>
      </Card>

      <Card title="위험·수익 지표 (과거 데이터)">
        {!stats ? (
          <Notice tone="warning">가격 이력이 부족해 통계를 계산할 수 없습니다.</Notice>
        ) : (
          <div className="space-y-3">
            {stats.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
            <p className="text-xs text-slate-500">
              기간 {stats.startDate} ~ {stats.endDate} ({stats.observations}일) · 무위험수익률 {s.riskFreeRatePct}% (설정에서 변경) · 원화 가격 기준
            </p>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[520px] text-sm num">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                    <th className="py-2">지표</th>
                    <th className="py-2 text-right">{s.assets.stock.name}</th>
                    <th className="py-2 text-right">{s.assets.bond.name}</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label={<Term label="연 수익률">과거 기간 동안 1년에 평균 몇 %씩 올랐는지 (복리 기준).</Term>} a={pct(stats.stock.annualReturn)} b={pct(stats.bond.annualReturn)} />
                  <Row label={<Term label="변동성">가격이 얼마나 출렁이는지. 클수록 위아래로 크게 움직입니다 (연 환산 표준편차).</Term>} a={pct(stats.stock.annualVol)} b={pct(stats.bond.annualVol)} />
                  <Row label={<Term label="샤프지수">위험(변동성) 1단위당 무위험수익률보다 얼마나 더 벌었는지. 클수록 효율적이었다는 뜻.</Term>} a={num(stats.stock.sharpe)} b={num(stats.bond.sharpe)} />
                  <Row label={<Term label="최대 낙폭">과거 최고점 대비 가장 크게 떨어졌던 비율.</Term>} a={pct(stats.stock.maxDrawdown)} b={pct(stats.bond.maxDrawdown)} />
                  <Row label={<Term label="베타">시장(여기서는 S&P500 ETF)이 1% 움직일 때 몇 % 움직였는지. 채권 베타가 0보다 작으면 주식과 반대로 움직이는 경향.</Term>} a={num(stats.stock.beta)} b={num(stats.bond.beta)} />
                  <Row label={<Term label="CAPM 기대수익률">무위험수익률 + 베타 × (시장 수익률 − 무위험수익률). 이론상 "위험에 대한 보상"을 계산한 참고값이며 미래 수익이 아닙니다.</Term>} a={pct(stats.stock.capmExpected)} b={pct(stats.bond.capmExpected)} />
                </tbody>
              </table>
            </div>
            <p className="text-sm">
              <Term label="상관관계">-1~1 사이 값. 1에 가까우면 함께 움직이고, 0 이하이면 주식이 떨어질 때 채권이 버텨주는(분산 효과) 경향이 있었다는 뜻입니다.</Term>
              : <b className="num">{num(stats.correlation)}</b>
            </p>
          </div>
        )}
      </Card>

      <Card title="모델 참고 비중 (자동 적용 안 함)">
        <Notice>
          아래는 과거 데이터로 계산한 <b>참고용</b> 비중입니다. 내가 정한 목표 비중과 다르며, 정답이 아닙니다. 현금 비중({s.targets.cash}%)은 그대로 두고 나머지를 주식·채권에 나눴습니다. 과거 데이터로 계산한 결과는 미래 수익을 보장하지 않습니다.
        </Notice>
        {stats && mine && (
          <div className="-mx-4 mt-3 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] text-sm num">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                  <th className="py-2">방식</th>
                  <th className="py-2 text-right">주식</th>
                  <th className="py-2 text-right">채권</th>
                  <th className="py-2 text-right">현금</th>
                  <th className="py-2 text-right">과거 기준 수익률</th>
                  <th className="py-2 text-right">과거 기준 변동성</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-100 bg-slate-50 font-medium dark:border-slate-800 dark:bg-slate-800/50">
                  <td className="py-2">내 목표 비중</td>
                  <td className="py-2 text-right">{s.targets.stock}%</td>
                  <td className="py-2 text-right">{s.targets.bond}%</td>
                  <td className="py-2 text-right">{s.targets.cash}%</td>
                  <td className="py-2 text-right">{pct(mine.expectedReturn)}</td>
                  <td className="py-2 text-right">{pct(mine.expectedVol)}</td>
                  <td />
                </tr>
                {refs.map((r) => (
                  <tr key={r.key} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2">
                      <Term label={r.name}>{r.description}</Term>
                    </td>
                    <td className="py-2 text-right">{r.stock}%</td>
                    <td className="py-2 text-right">{r.bond}%</td>
                    <td className="py-2 text-right">{r.cash}%</td>
                    <td className="py-2 text-right">{pct(r.expectedReturn)}</td>
                    <td className="py-2 text-right">{pct(r.expectedVol)}</td>
                    <td className="py-2 text-right">
                      <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setApply(r)}>
                        목표로 적용…
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {msg && <div className="mt-3"><Notice>{msg}</Notice></div>}
      </Card>
      <Disclaimer />

      {apply && (
        <Modal title="목표 비중을 바꿀까요?" onClose={() => setApply(null)}>
          <div className="space-y-3 text-sm">
            <p>
              현재 목표: 주식 {s.targets.stock}% · 채권 {s.targets.bond}% · 현금 {s.targets.cash}%
              <br />
              변경 후: 주식 <b>{apply.stock}%</b> · 채권 <b>{apply.bond}%</b> · 현금 <b>{apply.cash}%</b>
            </p>
            <Notice tone="warning">
              이 비중은 과거 데이터에 맞춘 참고값입니다. 데이터 기간이 짧고, 미래에는 다르게 움직일 수 있습니다. 이해하신 경우에만 적용하세요. 언제든 설정에서 되돌릴 수 있습니다.
            </Notice>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setApply(null)}>취소</Button>
              <Button onClick={doApply}>이해했고, 적용합니다</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, a, b }: { label: ReactNode; a: string; b: string }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2">{label}</td>
      <td className="py-2 text-right">{a}</td>
      <td className="py-2 text-right">{b}</td>
    </tr>
  );
}

function MiniChart({ title, data, color }: { title: string; data: SeriesPoint[]; color: string }) {
  if (data.length < 2) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium">{title}</p>
        <div className="flex h-40 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500 dark:bg-slate-800/60">데이터 없음</div>
      </div>
    );
  }
  const first = data[0].close;
  const last = data[data.length - 1].close;
  return (
    <div>
      <p className="mb-1 text-sm font-medium">
        {title} <span className="text-xs text-slate-500 num">기간 변화 {((last / first - 1) * 100).toFixed(1)}%</span>
      </p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={48} tickFormatter={(v: number) => v.toLocaleString('ko-KR')} />
            <Tooltip formatter={(v) => Number(v).toLocaleString('ko-KR')} labelFormatter={(l) => `${l} 종가`} />
            <Line type="monotone" dataKey="close" stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
