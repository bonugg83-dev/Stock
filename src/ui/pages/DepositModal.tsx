import { useMemo, useState } from 'react';
import { useAppData } from '../../app/AppData';
import { addCashEntry, recordTrades, saveRebalanceRecord, type ExecutedTrade } from '../../db/repo';
import { calculatePlan, type Plan } from '../../engine/allocate';
import { formatWon } from '../../engine/money';
import { isValidDateString, validateDepositAmount } from '../../engine/validation';
import { Button, Field, Input, Modal, MoneyInput, Notice } from '../components/ui';
import { ExecuteForm, PlanTable } from '../components/PlanView';
import { planToRecord } from '../planRecord';

type Step = 'input' | 'preview' | 'execute' | 'done';

/**
 * [잔고에 돈 넣기]
 * 1) 얼마를 넣을지 입력 → 2) 남은 현금 + 추가 현금으로 몇 주씩 살지 미리 보기 → 3) 저장
 * 저장 전에는 아무것도 바뀌지 않는다.
 */
export default function DepositModal({ onClose }: { onClose: () => void }) {
  const app = useAppData();
  const s = app.settings!;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(app.today);
  const [kind, setKind] = useState<'deposit' | 'distribution'>('deposit');
  const [use, setUse] = useState<'invest' | 'hold'>('invest');
  const [memo, setMemo] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');

  const amt = Number(amount || 0);
  const plan = useMemo(() => {
    if (!app.quotes.stock || !app.quotes.bond) return null;
    return calculatePlan({
      state: app.portfolioState,
      prices: { stock: app.quotes.stock.close, bond: app.quotes.bond.close },
      targets: s.targets,
      costs: { feeRatePct: s.feeRatePct, taxRatePct: s.taxRatePct },
      additionalCash: amt,
      mode: 'cashFirst',
      tolerancePctPoint: s.tolerancePctPoint,
    });
  }, [app.portfolioState, app.quotes, s, amt]);

  const next = () => {
    const e = validateDepositAmount(amt) ?? (amt === 0 ? '0원보다 큰 금액을 입력해주세요.' : null) ?? (!isValidDateString(date) ? '올바른 날짜를 입력해주세요.' : null);
    setError(e);
    if (!e) setStep('preview');
  };

  const saveCash = async () => {
    await addCashEntry({ date, type: kind, amount: amt, memo: memo || (kind === 'distribution' ? '분배금 입금' : '추가 납입') });
  };

  const saveOnly = async () => {
    await saveCash();
    if (plan?.ok && use === 'invest') await saveRebalanceRecord(planToRecord(plan, 'deposit', app, s, true));
    setResult(`${formatWon(amt)}을 현금 잔고에 넣었습니다.${use === 'invest' ? ' 계산 결과는 기록 화면에 저장했습니다. 실제로 매수한 뒤 기록 화면에서 체결 내용을 입력할 수 있습니다.' : ''}`);
    setStep('done');
  };

  const saveWithTrades = async (trades: ExecutedTrade[]) => {
    await saveCash();
    const groupId = crypto.randomUUID();
    await recordTrades(date, trades, groupId);
    if (plan?.ok) {
      await saveRebalanceRecord({ ...planToRecord(plan, 'deposit', app, s, true), executed: true, executedAt: new Date().toISOString(), executionMemo: '납입과 함께 체결 기록' });
    }
    setResult(`${formatWon(amt)} 입금과 체결 내용을 저장했습니다.`);
    setStep('done');
  };

  return (
    <Modal title="잔고에 돈 넣기" onClose={onClose}>
      {step === 'input' && (
        <div className="space-y-4">
          <Field label="얼마를 추가로 넣으실 건가요?">
            <MoneyInput value={amount} onChange={setAmount} autoFocus placeholder="예: 500,000" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[100000, 300000, 500000, 1000000].map((v) => (
              <Button key={v} variant="secondary" className="px-3 py-1" onClick={() => setAmount(String(Number(amount || 0) + v))}>
                +{(v / 10000).toLocaleString()}만
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="날짜">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="종류" hint="분배금은 원금이 아닌 수익으로 계산됩니다">
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'distribution')}>
                <option value="deposit">추가 납입 (내 돈)</option>
                <option value="distribution">분배금 (ETF에서 받은 돈)</option>
              </select>
            </Field>
          </div>
          <Field label="이 돈을 어떻게 할까요?">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={use === 'invest'} onChange={() => setUse('invest')} /> 투자에 사용 (매수 수량 계산)
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={use === 'hold'} onChange={() => setUse('hold')} /> 현금으로 보유
              </label>
            </div>
          </Field>
          <Field label="메모 (선택)">
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <p className="text-sm text-slate-600 dark:text-slate-300">현재 남아 있는 현금: <b className="num">{formatWon(app.cash)}</b></p>
          {error && <Notice tone="warning">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>취소</Button>
            <Button onClick={next}>계산 결과 미리 보기</Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm">
            남아 있는 현금 <b className="num">{formatWon(app.cash)}</b> + 추가 현금 <b className="num">{formatWon(amt)}</b> = 사용 가능 현금{' '}
            <b className="num">{formatWon(app.cash.add(amt))}</b>
          </p>
          {use === 'hold' ? (
            <Notice>매수 계산 없이 현금으로만 보유합니다. 다음 리밸런싱 때 비중 계산에 포함됩니다.</Notice>
          ) : !plan ? (
            <Notice tone="warning">가격 데이터가 없어 매수 수량을 계산할 수 없습니다. 입금만 저장하고 나중에 계산할 수 있습니다.</Notice>
          ) : !plan.ok ? (
            <Notice tone="warning">{plan.message}</Notice>
          ) : (
            <PlanSummary plan={plan} names={{ stock: s.assets.stock.name, bond: s.assets.bond.name }} priceDate={app.lastPriceDate} />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('input')}>이전</Button>
            <Button variant="secondary" onClick={onClose}>취소</Button>
            <Button variant="secondary" onClick={saveOnly}>입금만 저장</Button>
            {use === 'invest' && plan?.ok && plan.hasTrades && <Button onClick={() => setStep('execute')}>매수했어요 → 체결 입력</Button>}
          </div>
        </div>
      )}

      {step === 'execute' && plan?.ok && (
        <ExecuteForm plan={plan} feeRatePct={s.feeRatePct} onCancel={() => setStep('preview')} onSubmit={saveWithTrades} submitLabel="입금 + 체결 저장" />
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <Notice>{result}</Notice>
          <div className="flex justify-end">
            <Button onClick={onClose}>닫기</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PlanSummary({ plan, names, priceDate }: { plan: Plan; names: { stock: string; bond: string }; priceDate: string | null }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
        <p className="font-medium">계산상 매수안 (현금 우선형, 매도 없음)</p>
        <ul className="mt-1 list-inside list-disc">
          {(['stock', 'bond'] as const).map((a) => (
            <li key={a}>
              {names[a]}: {plan.lines[a].quantity > 0 ? <b>{plan.lines[a].quantity}주 ({formatWon(plan.lines[a].tradeAmount)})</b> : '매수 없음'}
            </li>
          ))}
          <li>매수 후 남는 현금: <b>{formatWon(plan.cashAfter)}</b></li>
        </ul>
        <p className="mt-1 text-xs text-slate-500">기준 가격: {priceDate} 종가. 실제 주문 전 현재가를 확인하세요.</p>
      </div>
      <PlanTable plan={plan} names={names} />
    </div>
  );
}
