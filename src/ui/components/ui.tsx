import { useId, useState, type ReactNode, type InputHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { formatPct, formatPctPoint, type Dec } from '../../engine/money';
import { ASSET_LABEL, ALL_ASSETS, type AssetKey } from '../../engine/types';
import { FRESHNESS_LABEL, type Freshness } from '../../engine/freshness';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
        variant === 'secondary' && 'border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
        variant === 'ghost' && 'hover:bg-slate-100 dark:hover:bg-slate-800',
        variant === 'danger' && 'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-100',
        className,
      )}
    />
  );
}

/** 금융 용어 쉬운 설명 (? 아이콘) */
export function Term({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex items-center gap-1">
      {label}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label="용어 설명"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] leading-none text-slate-500"
      >
        ?
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-6 z-20 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal leading-relaxed text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {children}
        </span>
      )}
    </span>
  );
}

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm num dark:border-slate-700 dark:bg-slate-950',
        props.className,
      )}
    />
  );
}

/** 금액 입력: 쉼표 표시, 숫자만 */
export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const display = value === '' ? '' : Number(value).toLocaleString('ko-KR');
  return (
    <div className="relative">
      <Input
        inputMode="numeric"
        autoFocus={autoFocus}
        value={display}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''))}
        className="pr-8 text-right"
      />
      <span className="pointer-events-none absolute right-3 top-2 text-sm text-slate-500">원</span>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-lg border px-3 py-2 text-sm leading-relaxed',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
        tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
      )}
    >
      {children}
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="text-xs leading-relaxed text-slate-500">
      이 앱은 사용자가 설정한 규칙과 입력값을 바탕으로 포트폴리오 비중과 계산상 조정안을 보여주는 도구입니다. 투자 권유, 수익 보장, 손실 방지를 의미하지 않습니다. 가격·환율·세금·거래 비용 데이터가 실제와 다를 수 있으므로, 실제 거래 전에 사용자가 최신 정보를 직접 확인해야 합니다.
    </p>
  );
}

export function FreshnessBadge({ f, isMock }: { f: Freshness; isMock?: boolean }) {
  if (isMock) return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">가상(Mock) 데이터</span>;
  return (
    <span
      className={cx(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        f === 'fresh' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
        f === 'stale' && 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
        f === 'missing' && 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      {FRESHNESS_LABEL[f]}
    </span>
  );
}

const BAR_COLOR: Record<AssetKey, string> = { stock: 'bg-stock', bond: 'bg-bond', cash: 'bg-cash' };

/** 실제 비중 vs 목표 비중: 색상 + 숫자 동시 표시 */
export function WeightBars({ actual, target }: { actual: Record<AssetKey, Dec | null> | null; target: Record<AssetKey, number> }) {
  return (
    <div className="space-y-3">
      {ALL_ASSETS.map((a) => {
        const w = actual?.[a] ?? null;
        const diff = w === null ? null : w.sub(target[a]);
        return (
          <div key={a}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
              <span className="flex shrink-0 items-center gap-2 font-medium">
                <span className={cx('inline-block h-3 w-3 rounded-sm', BAR_COLOR[a])} />
                {ASSET_LABEL[a]}
              </span>
              <span className="num text-slate-600 dark:text-slate-300">
                실제 <b className="text-slate-900 dark:text-white">{formatPct(w)}</b> / 목표 {target[a]}% · 차이 <b>{formatPctPoint(diff)}</b>
              </span>
            </div>
            <div className="relative h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={cx('h-3 rounded-full', BAR_COLOR[a])} style={{ width: `${Math.min(100, Math.max(0, w?.toNumber() ?? 0))}%` }} />
              <div className="absolute top-[-3px] h-[18px] w-0.5 bg-slate-900 dark:bg-white" style={{ left: `${target[a]}%` }} title={`목표 ${target[a]}%`} />
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">막대 = 실제 비중, 세로선 = 목표 비중</p>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="rounded p-1 text-xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const formatDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }) : '—';
