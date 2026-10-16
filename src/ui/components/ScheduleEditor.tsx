import { useState } from 'react';
import type { RebalanceSchedule } from '../../engine/schedule';
import { Field, Input, cx } from './ui';

export function ScheduleEditor({ value, onChange, error }: { value: RebalanceSchedule; onChange: (s: RebalanceSchedule) => void; error?: string }) {
  const [customText, setCustomText] = useState(value.type === 'custom' ? value.dates.join(', ') : '03-15, 06-15, 09-15, 12-15');
  const months = value.type === 'firstTradingDay' ? value.months : [];
  const parseCustom = (t: string) =>
    t
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter((x) => /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x));

  return (
    <Field label="리밸런싱 기준일" error={error} hint="첫 거래일은 주말·양력 공휴일만 제외한 근사값입니다 (설·추석 연휴는 반영 안 됨).">
      <div className="space-y-2">
        <div className="flex gap-2 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={value.type === 'firstTradingDay'} onChange={() => onChange({ type: 'firstTradingDay', months: [1, 4, 7, 10] })} />
            지정한 달의 첫 거래일
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={value.type === 'custom'} onChange={() => onChange({ type: 'custom', dates: parseCustom(customText) })} />
            직접 날짜 지정
          </label>
        </div>
        {value.type === 'firstTradingDay' ? (
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => onChange({ type: 'firstTradingDay', months: months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b) })}
                className={cx(
                  'rounded-md border py-1 text-sm',
                  months.includes(m) ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 dark:border-slate-700',
                )}
              >
                {m}월
              </button>
            ))}
          </div>
        ) : (
          <Input
            value={customText}
            placeholder="MM-DD, 쉼표로 구분 (예: 03-15, 09-15)"
            onChange={(e) => {
              setCustomText(e.target.value);
              onChange({ type: 'custom', dates: parseCustom(e.target.value) });
            }}
          />
        )}
      </div>
    </Field>
  );
}
