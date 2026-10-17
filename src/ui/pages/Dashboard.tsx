import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../../app/AppData';
import { computePerformance } from '../../app/performance';
import { calculatePlan } from '../../engine/allocate';
import { d, formatPct, formatPctPoint, formatWon } from '../../engine/money';
import { usdExposurePct, weightDiffs } from '../../engine/portfolio';
import { assetReturnPct, simpleReturnPct } from '../../engine/returns';
import { daysBetween } from '../../engine/schedule';
import { ASSET_LABEL, RISKY_ASSETS, type AssetKey } from '../../engine/types';
import type { Quote } from '../../data/marketTypes';
import { Button, Card, Disclaimer, FreshnessBadge, Notice, Term, WeightBars, cx, formatDateTime } from '../components/ui';
import DepositModal from './DepositModal';
import { BackupReminder } from '../components/BackupReminder';

export default function Dashboard() {
  const app = useAppData();
  const s = app.settings!;
  const [depositOpen, setDepositOpen] = useState(false);
  const v = app.valuation;

  const perf = useMemo(() => {
    if (!v) return null;
    return computePerformance(app.ledger, { stock: app.history.stock, bond: app.history.bond }, app.today, v.total.toNumber());
  }, [app.ledger, app.history, app.today, v]);

  const plan = useMemo(() => {
    if (!app.quotes.stock || !app.quotes.bond) return null;
    return calculatePlan({
      state: app.portfolioState,
      prices: { stock: app.quotes.stock.close, bond: app.quotes.bond.close },
      targets: s.targets,
      costs: { feeRatePct: s.feeRatePct, taxRatePct: s.taxRatePct },
      mode: s.rebalanceMode,
      tolerancePctPoint: s.tolerancePctPoint,
    });
  }, [app.portfolioState, app.quotes, s]);

  const daysLeft = app.nextRebalance ? daysBetween(app.today, app.nextRebalance) : null;
  const diffs = v ? weightDiffs(v, s.targets) : null;
  const biggest = diffs
    ? (['stock', 'bond', 'cash'] as AssetKey[]).reduce((m, a) => (diffs[a]!.abs().gt(diffs[m]!.abs()) ? a : m), 'stock' as AssetKey)
    : null;
  const usd = v ? usdExposurePct(v, { stock: s.assets.stock.fxExposed, bond: s.assets.bond.fxExposed }) : null;

  return (
    <div className="space-y-4">
      <BackupReminder />
      {/* 행동 안내 */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">다음 리밸런싱 · {app.nextRebalance}</p>
            <p className="text-2xl font-bold">{daysLeft === 0 ? '오늘이 리밸런싱 예정일입니다' : `${daysLeft}일 남았습니다`}</p>
          </div>
          <Button className="py-3 text-base" onClick={() => setDepositOpen(true)}>
            ＋ 잔고에 돈 넣기
          </Button>
        </div>
        {v && diffs && biggest && (
          <div className="mt-3 space-y-1 text-sm leading-relaxed">
            <p>
              현재 {ASSET_LABEL[biggest]} 비중이 목표보다 <b>{formatPctPoint(diffs[biggest]).replace('+', '')}</b>{' '}
              {diffs[biggest]!.gte(0) ? '높습니다' : '낮습니다'} (허용 오차 ±{s.tolerancePctPoint}%p).
            </p>
            {plan?.ok && plan.hasTrades && (
              <p>
                계산상 조정안:{' '}
                {RISKY_ASSETS.filter((a) => plan.lines[a].quantity > 0)
                  .map((a) => `${s.assets[a].name} 약 ${formatWon(plan.lines[a].tradeAmount)}어치(${plan.lines[a].quantity}주) ${plan.lines[a].action === 'buy' ? '매수' : '매도'}`)
                  .join(', ')}
                를 검토할 수 있습니다.{' '}
                <Link to="/rebalance" className="underline">
                  자세히 보기
                </Link>
              </p>
            )}
            {plan?.ok && !plan.hasTrades && <p>현재 보유 현금으로 계산상 필요한 조정은 없습니다.</p>}
            <p className="text-xs text-slate-500">이는 설정한 규칙에 따른 계산 결과이며 매매 권유가 아닙니다.</p>
          </div>
        )}
      </Card>

      {/* 시장 정보 */}
      <Card
        title="시장 정보"
        actions={
          <div className="flex items-center gap-2">
            <FreshnessBadge f={app.freshness} isMock={app.market?.file?.isMock} />
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={app.reloadMarket} disabled={app.marketLoading}>
              {app.marketLoading ? '불러오는 중…' : '새로고침'}
            </Button>
          </div>
        }
      >
        {app.market?.error && (
          <div className="mb-3">
            <Notice tone="warning">
              {app.market.error}
              {app.market.fromCache ? ' 마지막으로 성공한 데이터를 표시합니다.' : ''}
            </Notice>
          </div>
        )}
        {app.freshness === 'stale' && (
          <div className="mb-3">
            <Notice tone="warning">최신 데이터가 아닐 수 있습니다 (가격 기준일 {app.lastPriceDate}).</Notice>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <QuoteTile label={s.assets.stock.name} code={s.assets.stock.code} q={app.quotes.stock} />
          <QuoteTile label={s.assets.bond.name} code={s.assets.bond.code} q={app.quotes.bond} />
          <QuoteTile label="USD/KRW 환율" q={app.quotes.fx} decimals={2} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {app.market?.file?.delayNote ?? '데이터 없음'} · 마지막 확인 {formatDateTime(app.market?.checkedAt)}
        </p>
      </Card>

      {/* 내 포트폴리오 */}
      <Card title="내 포트폴리오">
        {!v ? (
          <Notice tone="warning">가격 데이터가 없어 평가금액을 계산할 수 없습니다. 임의의 값을 보여드리지 않습니다.</Notice>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Big label="전체 평가금액" value={formatWon(v.total)} />
              <Big label={`주식 (${app.holdings.stock.shares}주)`} value={formatWon(v.values.stock)} />
              <Big label={`채권 (${app.holdings.bond.shares}주)`} value={formatWon(v.values.bond)} />
              <Big label="현금 잔액" value={formatWon(v.values.cash)} />
            </div>
            <WeightBars actual={v.weights} target={s.targets} />
            {usd && (
              <p className="text-sm">
                <Term label="달러 노출 비중">
                  두 ETF 모두 환헤지를 하지 않아(환노출형) 원/달러 환율이 오르면 원화 평가금액이 오르고, 내리면 함께 내립니다. 위기 때 달러 강세가 손실을 줄여주는 경우가 많지만 항상 그렇지는 않습니다.
                </Term>
                : <b className="num">{formatPct(usd)}</b>
              </p>
            )}
          </div>
        )}
      </Card>

      {/* 수익률 */}
      <Card title="수익률">
        {!v ? (
          <p className="text-sm text-slate-500">가격 데이터가 있어야 계산할 수 있습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric
              label={<Term label="납입 원금 대비">순납입원금(넣은 돈 - 뺀 돈) 대비 현재 평가금액이 몇 % 늘었는지. 언제 넣었는지는 고려하지 않습니다.</Term>}
              value={formatPct(simpleReturnPct(v.total, app.contribution))}
              sub={`원금 ${formatWon(app.contribution)}`}
            />
            <Metric
              label={<Term label="연 환산 (XIRR)">돈을 넣은 날짜와 금액까지 반영해 "1년에 몇 %씩 불어났는지"로 환산한 값. 기간이 짧으면 크게 출렁일 수 있습니다.</Term>}
              value={perf?.xirr != null ? formatPct(perf.xirr * 100) : '—'}
            />
            <Metric
              label={<Term label="시간가중 (TWR)">납입 시점·금액의 영향을 빼고, 포트폴리오 운용 자체의 누적 성과를 본 값.</Term>}
              value={perf?.twr != null ? formatPct(perf.twr * 100) : '—'}
            />
            {RISKY_ASSETS.map((a) => (
              <Metric
                key={a}
                label={`${ASSET_LABEL[a]} 수익률`}
                value={app.holdings[a].shares > 0 && app.holdings[a].costBasis > 0 ? formatPct(assetReturnPct(v.values[a], app.holdings[a].costBasis)) : '—'}
                sub={app.holdings[a].avgPrice ? `평균 매입가 ${formatWon(d(app.holdings[a].avgPrice!))}` : '보유 없음'}
              />
            ))}
          </div>
        )}
      </Card>

      <Disclaimer />
      {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} />}
    </div>
  );
}

function QuoteTile({ label, code, q, decimals = 0 }: { label: string; code?: string; q: Quote | null; decimals?: number }) {
  if (!q) {
    return (
      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-sm text-slate-500">데이터 없음</p>
      </div>
    );
  }
  const up = (q.change ?? 0) > 0;
  const down = (q.change ?? 0) < 0;
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-sm font-medium">
        {label} {code && <span className="text-xs text-slate-500">({code})</span>}
      </p>
      <p className="mt-1 text-xl font-bold num">
        {q.close.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
        <span className="ml-1 text-xs font-normal text-slate-500">{q.unit}</span>
      </p>
      <p className={cx('text-sm num', up && 'text-rose-600 dark:text-rose-400', down && 'text-blue-600 dark:text-blue-400')}>
        전일 대비 {q.change === null ? '—' : `${up ? '▲' : down ? '▼' : ''} ${Math.abs(q.change).toLocaleString('ko-KR', { maximumFractionDigits: decimals })} (${formatPctPoint(q.changePct).replace('%p', '%')})`}
      </p>
      <p className="text-xs text-slate-500">
        기준 {q.date} 종가 · {q.source}
      </p>
    </div>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold num">{value}</p>
    </div>
  );
}

function Metric({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold num">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
