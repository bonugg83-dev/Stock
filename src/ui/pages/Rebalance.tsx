import { useMemo, useState } from 'react';
import { useAppData } from '../../app/AppData';
import { recordTrades, saveRebalanceRecord, markExecuted, type ExecutedTrade } from '../../db/repo';
import { calculatePlan } from '../../engine/allocate';
import type { RebalanceMode } from '../../engine/types';
import { daysBetween } from '../../engine/schedule';
import { Button, Card, Disclaimer, FreshnessBadge, Modal, Notice, Term, cx, formatDateTime } from '../components/ui';
import { ExecuteForm, PlanTable } from '../components/PlanView';
import { planToRecord } from '../planRecord';

export default function Rebalance() {
  const app = useAppData();
  const s = app.settings!;
  const [mode, setMode] = useState<RebalanceMode>(s.rebalanceMode);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const calcAt = useMemo(() => new Date().toISOString(), [app.quotes, app.portfolioState, mode]);

  const plan = useMemo(() => {
    if (!app.quotes.stock || !app.quotes.bond) return null;
    return calculatePlan({
      state: app.portfolioState,
      prices: { stock: app.quotes.stock.close, bond: app.quotes.bond.close },
      targets: s.targets,
      costs: { feeRatePct: s.feeRatePct, taxRatePct: s.taxRatePct },
      mode,
      tolerancePctPoint: s.tolerancePctPoint,
    });
  }, [app.portfolioState, app.quotes, s, mode]);

  const left = app.nextRebalance ? daysBetween(app.today, app.nextRebalance) : null;

  const save = async () => {
    if (!plan?.ok) return;
    const id = await saveRebalanceRecord(planToRecord(plan, 'rebalance', app, s, true));
    setSavedId(id);
    setConfirmOpen(false);
    setMsg('계산 결과를 기록에 저장했습니다. 실제로 매매했다면 아래 버튼으로 체결 내용을 입력하세요.');
  };

  const execute = async (trades: ExecutedTrade[]) => {
    if (savedId === null) return;
    await recordTrades(app.today, trades, `rebalance-${savedId}`);
    await markExecuted(savedId, '리밸런싱 화면에서 체결 기록');
    setExecOpen(false);
    setSavedId(null);
    setMsg('체결 내용을 반영했습니다. 보유 수량과 현금이 업데이트되었습니다.');
  };

  return (
    <div className="space-y-4">
      <Card
        title="리밸런싱 분석"
        actions={<FreshnessBadge f={app.freshness} isMock={app.market?.file?.isMock} />}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          다음 예정일 <b>{app.nextRebalance}</b> ({left === 0 ? '오늘' : `${left}일 남음`}) · 계산 기준 가격 {app.lastPriceDate ?? '—'} 종가 · 계산 시각 {formatDateTime(calcAt)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['cashFirst', 'full'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cx(
                'rounded-lg border p-3 text-left text-sm',
                mode === m ? 'border-slate-800 ring-1 ring-slate-800 dark:border-slate-100 dark:ring-slate-100' : 'border-slate-300 dark:border-slate-700',
              )}
            >
              <div className="font-semibold">{m === 'cashFirst' ? '현금 우선형 (기본)' : '매매형'}</div>
              <div className="mt-1 text-xs text-slate-500">
                {m === 'cashFirst'
                  ? '팔지 않고, 남은 현금으로 부족한 자산만 삽니다. 거래·세금이 적지만 목표에 못 미칠 수 있습니다.'
                  : '많은 자산을 팔고 적은 자산을 삽니다. 목표에 가깝게 맞추지만 매도 차익 세금·수수료가 생길 수 있습니다.'}
              </div>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          방식 선택은 세금·거래 비용·실제 결과에 영향을 줍니다. 현재 설정: 수수료 {s.feeRatePct}%, 매매차익 세율 {s.taxRatePct}% (
          <Term label="추정">국내 상장 해외 ETF는 일반 계좌에서 매매차익에 배당소득세 15.4%가 붙습니다(실제는 과세표준기준가 기준). 연금저축·IRP·ISA는 과세가 이연·감면됩니다.</Term>)
        </p>
      </Card>

      <Card title="계산 결과">
        {!plan ? (
          <Notice tone="warning">가격 데이터가 없어 계산을 진행하지 않습니다. 대시보드에서 데이터를 새로고침하거나 설정에서 데이터 상태를 확인하세요.</Notice>
        ) : !plan.ok ? (
          <Notice tone="warning">{plan.message}</Notice>
        ) : (
          <>
            {app.freshness === 'stale' && (
              <div className="mb-3">
                <Notice tone="warning">가격 데이터가 오래되었습니다. 최신 데이터가 아닐 수 있으니 실제 거래 전 현재가를 확인하세요.</Notice>
              </div>
            )}
            <PlanTable plan={plan} names={{ stock: s.assets.stock.name, bond: s.assets.bond.name }} />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {savedId === null ? (
                <Button onClick={() => setConfirmOpen(true)}>이 계산 결과 확인 · 기록</Button>
              ) : (
                <Button onClick={() => setExecOpen(true)}>실제로 매매했어요 → 체결 입력</Button>
              )}
            </div>
          </>
        )}
        {msg && <div className="mt-3"><Notice>{msg}</Notice></div>}
      </Card>
      <Disclaimer />

      {confirmOpen && plan?.ok && (
        <Modal title="계산 결과 확인" onClose={() => setConfirmOpen(false)}>
          <div className="space-y-3 text-sm">
            <p>이 결과는 설정한 규칙에 따른 <b>계산상 조정안</b>이며, 매매 권유가 아닙니다. 기록 화면에 저장하며 보유 수량은 바뀌지 않습니다.</p>
            <p>실제 주문 전에 증권사 앱에서 현재가·수수료·세금을 직접 확인하세요.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>취소</Button>
              <Button onClick={save}>확인했습니다 · 기록 저장</Button>
            </div>
          </div>
        </Modal>
      )}
      {execOpen && plan?.ok && (
        <Modal title="실제 체결 내용 입력" onClose={() => setExecOpen(false)}>
          <ExecuteForm plan={plan} feeRatePct={s.feeRatePct} onSubmit={execute} onCancel={() => setExecOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
