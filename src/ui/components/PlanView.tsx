import { useState } from 'react';
import type { Plan } from '../../engine/allocate';
import { formatPct, formatPctPoint, formatWon } from '../../engine/money';
import { ALL_ASSETS, ASSET_LABEL, RISKY_ASSETS, type RiskyAsset } from '../../engine/types';
import type { ExecutedTrade } from '../../db/repo';
import { Button, Input, Notice, cx } from './ui';

const ACTION_LABEL = { buy: '매수 검토', sell: '매도 검토', hold: '유지' } as const;

export function PlanTable({ plan, names }: { plan: Plan; names: Record<RiskyAsset, string> }) {
  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[640px] text-sm num">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
              <th className="py-2 pr-2">자산</th>
              <th className="py-2 pr-2 text-right">현재 평가금액</th>
              <th className="py-2 pr-2 text-right">현재 → 목표 비중</th>
              <th className="py-2 pr-2 text-right">차이</th>
              <th className="py-2 pr-2 text-right">목표 금액</th>
              <th className="py-2 pr-2 text-center">계산상 조정</th>
              <th className="py-2 pr-2 text-right">수량·금액</th>
              <th className="py-2 text-right">조정 후 비중 (차이)</th>
            </tr>
          </thead>
          <tbody>
            {ALL_ASSETS.map((a) => {
              const l = plan.lines[a];
              return (
                <tr key={a} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-2">
                    <div className="font-medium">{ASSET_LABEL[a]}</div>
                    <div className="text-xs text-slate-500">
                      {a === 'cash' ? '원화 현금' : `${names[a]} · ${l.sharesBefore}주 × ${formatWon(l.price)}`}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right">{formatWon(l.valueBefore)}</td>
                  <td className="py-2 pr-2 text-right">
                    {formatPct(l.weightBefore)} → {l.targetWeight.toString()}%
                  </td>
                  <td className="py-2 pr-2 text-right">{formatPctPoint(l.diffBefore)}</td>
                  <td className="py-2 pr-2 text-right">{formatWon(l.targetValue)}</td>
                  <td className="py-2 pr-2 text-center">
                    {a === 'cash' ? (
                      <span className="text-xs text-slate-500">잔여 현금</span>
                    ) : (
                      <span
                        className={cx(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          l.action === 'buy' && 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
                          l.action === 'sell' && 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
                          l.action === 'hold' && 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                        )}
                      >
                        {ACTION_LABEL[l.action]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {a === 'cash' ? (
                      formatWon(plan.cashAfter)
                    ) : l.quantity > 0 ? (
                      <>
                        <div className="font-semibold">{l.quantity.toLocaleString('ko-KR')}주</div>
                        <div className="text-xs text-slate-500">{formatWon(l.tradeAmount)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {formatPct(l.weightAfter)} <span className="text-xs text-slate-500">({formatPctPoint(l.diffAfter)})</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="전체 투자 가능금액" value={formatWon(plan.totalBefore)} />
        <Stat label="거래 후 남는 현금" value={formatWon(plan.cashAfter)} />
        <Stat label="예상 수수료" value={formatWon(plan.totalFees)} />
        <Stat label="예상 세금(추정)" value={formatWon(plan.totalTax)} />
      </dl>
      {plan.notes.map((n) => (
        <Notice key={n} tone={n.includes('없습니다') || n.includes('초과') || n.includes('필요할 수') ? 'warning' : 'info'}>
          {n}
        </Notice>
      ))}
      <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <summary className="cursor-pointer font-medium">계산 과정 펼쳐 보기</summary>
        <ol className="mt-3 space-y-3">
          {plan.steps.map((s) => (
            <li key={s.label}>
              <div className="font-medium">{s.label}</div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-slate-600 dark:text-slate-300 num">{s.detail}</pre>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold num">{value}</dd>
    </div>
  );
}

/** 실제 체결 내용 입력 (계산값으로 미리 채우고, 사용자가 수정) */
export function ExecuteForm({
  plan,
  feeRatePct,
  onSubmit,
  onCancel,
  submitLabel = '실제 매매 기록 저장',
}: {
  plan: Plan;
  feeRatePct: number;
  onSubmit: (trades: ExecutedTrade[]) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const init = Object.fromEntries(
    RISKY_ASSETS.map((a) => {
      const l = plan.lines[a];
      return [a, { side: l.action === 'sell' ? 'sell' : 'buy', shares: String(l.quantity), price: l.price?.toString() ?? '', tax: l.tax.toString() }];
    }),
  ) as Record<RiskyAsset, { side: 'buy' | 'sell'; shares: string; price: string; tax: string }>;
  const [rows, setRows] = useState(init);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const trades: ExecutedTrade[] = [];
    for (const a of RISKY_ASSETS) {
      const r = rows[a];
      const shares = Number(r.shares || 0);
      const price = Number(r.price);
      if (!Number.isInteger(shares) || shares < 0) return setError(`${ASSET_LABEL[a]} 수량은 0 이상의 정수여야 합니다.`);
      if (shares === 0) continue;
      if (!(price > 0)) return setError(`${ASSET_LABEL[a]} 체결 가격을 입력해주세요.`);
      const fee = Math.ceil((shares * price * feeRatePct) / 100);
      trades.push({ asset: a, side: r.side, shares, price, fee, tax: r.side === 'sell' ? Math.max(0, Number(r.tax || 0)) : 0 });
    }
    setBusy(true);
    try {
      await onSubmit(trades);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        증권사 앱에서 실제로 체결된 수량과 가격을 입력하세요. 계산값으로 미리 채워져 있습니다. 거래하지 않은 자산은 0주로 두세요.
      </p>
      {RISKY_ASSETS.map((a) => (
        <div key={a} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-4">
          <div className="col-span-2 font-medium sm:col-span-4">{ASSET_LABEL[a]}</div>
          <label className="text-xs">
            구분
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={rows[a].side}
              onChange={(e) => setRows({ ...rows, [a]: { ...rows[a], side: e.target.value as 'buy' | 'sell' } })}
            >
              <option value="buy">매수</option>
              <option value="sell">매도</option>
            </select>
          </label>
          <label className="text-xs">
            수량(주)
            <Input inputMode="numeric" value={rows[a].shares} onChange={(e) => setRows({ ...rows, [a]: { ...rows[a], shares: e.target.value.replace(/\D/g, '') } })} />
          </label>
          <label className="text-xs">
            체결가(원)
            <Input inputMode="decimal" value={rows[a].price} onChange={(e) => setRows({ ...rows, [a]: { ...rows[a], price: e.target.value.replace(/[^\d.]/g, '') } })} />
          </label>
          {rows[a].side === 'sell' && (
            <label className="text-xs">
              세금(원)
              <Input inputMode="numeric" value={rows[a].tax} onChange={(e) => setRows({ ...rows, [a]: { ...rows[a], tax: e.target.value.replace(/\D/g, '') } })} />
            </label>
          )}
        </div>
      ))}
      <p className="text-xs text-slate-500">수수료는 설정의 수수료율({feeRatePct}%)로 원 단위 올림 계산합니다.</p>
      {error && <Notice tone="warning">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          취소
        </Button>
        <Button onClick={submit} disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
