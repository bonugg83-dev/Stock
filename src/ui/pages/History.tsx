import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { markExecuted } from '../../db/repo';
import type { LedgerType } from '../../db/schema';
import { formatWon } from '../../engine/money';
import { ASSET_LABEL } from '../../engine/types';
import { Button, Card, cx, formatDateTime } from '../components/ui';

const LEDGER_LABEL: Record<LedgerType, string> = {
  deposit: '납입',
  withdraw: '출금',
  distribution: '분배금',
  buy: '매수',
  sell: '매도',
  fee: '수수료',
  tax: '세금',
  adjust: '잔액 조정',
};

const TABS = ['현금·거래', '계산 기록', '설정 변경'] as const;

export default function History() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('현금·거래');
  const ledger = useLiveQuery(() => db.ledger.orderBy('date').reverse().toArray(), []) ?? [];
  const recs = useLiveQuery(() => db.rebalances.orderBy('calculatedAt').reverse().toArray(), []) ?? [];
  const hist = useLiveQuery(() => db.settingsHistory.orderBy('changedAt').reverse().toArray(), []) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-lg px-3 py-2 text-sm', tab === t ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-white dark:bg-slate-900')}>
            {t}
          </button>
        ))}
      </div>

      {tab === '현금·거래' && (
        <Card title="납입·분배금·거래 기록">
          {ledger.length === 0 ? (
            <p className="text-sm text-slate-500">기록이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {ledger.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium">
                      {LEDGER_LABEL[e.type]} {e.asset && <span className="text-slate-500">· {ASSET_LABEL[e.asset]}</span>}
                      {e.shares ? <span className="text-slate-500"> {e.shares}주 @ {formatWon(e.price ?? 0)}</span> : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {e.date}
                      {e.memo ? ` · ${e.memo}` : ''}
                    </div>
                  </div>
                  <div className={cx('num font-semibold', e.amount < 0 && 'text-slate-500')}>{e.amount > 0 ? '+' : ''}{formatWon(e.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === '계산 기록' && (
        <Card title="리밸런싱·납입 계산 기록">
          {recs.length === 0 ? (
            <p className="text-sm text-slate-500">저장된 계산 결과가 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {recs.map((r) => (
                <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {r.kind === 'rebalance' ? '리밸런싱' : '추가 납입'} · {r.mode === 'cashFirst' ? '현금 우선형' : '매매형'}
                    </div>
                    <span className={cx('rounded-full px-2 py-0.5 text-xs', r.executed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
                      {r.executed ? '실제 매매 기록됨' : '확인만 함'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    계산 {formatDateTime(r.calculatedAt)} · 기준 가격 {r.priceDate} (주식 {formatWon(r.prices.stock)}, 채권 {formatWon(r.prices.bond)}) · 총액 {formatWon(r.totalBefore)}
                    {r.additionalCash ? ` · 납입 ${formatWon(r.additionalCash)}` : ''}
                  </div>
                  <div className="mt-1">
                    {r.lines
                      .filter((l) => l.asset !== 'cash')
                      .map((l) => `${ASSET_LABEL[l.asset]} ${l.action === 'hold' ? '유지' : `${l.quantity}주 ${l.action === 'buy' ? '매수' : '매도'}`}`)
                      .join(' · ')}
                  </div>
                  {!r.executed && (
                    <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={() => markExecuted(r.id!, '기록 화면에서 실행 표시')}>
                      실제로 매매했음으로 표시
                    </Button>
                  )}
                  {r.executed && r.executionMemo && <div className="mt-1 text-xs text-slate-500">{r.executionMemo} · {formatDateTime(r.executedAt)}</div>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            "실제로 매매했음으로 표시"는 기록 표시만 바꿉니다. 보유 수량을 바꾸려면 리밸런싱·납입 화면의 체결 입력을 사용하세요.
          </p>
        </Card>
      )}

      {tab === '설정 변경' && (
        <Card title="설정 변경 이력">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {hist.map((h) => (
              <li key={h.id} className="py-2">
                <div className="font-medium">{h.summary}</div>
                <div className="text-xs text-slate-500">{formatDateTime(h.changedAt)}</div>
                {Object.keys(h.before).length > 0 && (
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer">변경 내용</summary>
                    <pre className="whitespace-pre-wrap break-words">{JSON.stringify({ 이전: h.before, 이후: h.after }, null, 1)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
