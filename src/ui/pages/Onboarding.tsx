import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeOnboarding, importBackup, TAX_RATE_BY_ACCOUNT, type BackupFile } from '../../db/repo';
import type { AccountType } from '../../db/schema';
import { validateOnboarding, validateWeights } from '../../engine/validation';
import { nextRebalanceDate, todayKst, type RebalanceSchedule } from '../../engine/schedule';
import { useAppData } from '../../app/AppData';
import { Button, Card, Disclaimer, Field, FreshnessBadge, Input, MoneyInput, Notice, Term, formatDateTime } from '../components/ui';
import { ScheduleEditor } from '../components/ScheduleEditor';
import { formatWon } from '../../engine/money';

export default function Onboarding() {
  const nav = useNavigate();
  const [seed, setSeed] = useState('10000000');
  const [startDate, setStartDate] = useState(todayKst());
  const [w, setW] = useState({ stock: '60', bond: '30', cash: '10' });
  const [hasExisting, setHasExisting] = useState(false);
  const [ex, setEx] = useState({ stockShares: '0', stockAvg: '', bondShares: '0', bondAvg: '', cash: '' });
  const [schedule, setSchedule] = useState<RebalanceSchedule>({ type: 'firstTradingDay', months: [1, 4, 7, 10] });
  const [accountType, setAccountType] = useState<AccountType>('general');
  const [fee, setFee] = useState('0');
  const [tol, setTol] = useState('5');
  const [notifyTime, setNotifyTime] = useState('09:00');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const weights = { stock: Number(w.stock), bond: Number(w.bond), cash: Number(w.cash) };
  const wc = validateWeights(weights);

  const submit = async () => {
    const months = schedule.type === 'firstTradingDay' ? schedule.months : [1];
    const e: Record<string, string | undefined> = validateOnboarding({
      seedMoney: Number(seed),
      startDate,
      weights,
      shares: hasExisting ? { stock: Number(ex.stockShares), bond: Number(ex.bondShares) } : { stock: 0, bond: 0 },
      cash: hasExisting ? Number(ex.cash || 0) : Number(seed),
      rebalanceMonths: months,
      notifyTime,
    });
    if (schedule.type === 'custom' && schedule.dates.length === 0) e.rebalanceMonths = '리밸런싱 날짜를 1개 이상 입력해주세요.';
    if (hasExisting) {
      if (Number(ex.stockShares) > 0 && !(Number(ex.stockAvg) > 0)) e.stockAvg = '보유 수량이 있으면 평균 매입가를 입력해주세요 (수익률 계산에 필요).';
      if (Number(ex.bondShares) > 0 && !(Number(ex.bondAvg) > 0)) e.bondAvg = '보유 수량이 있으면 평균 매입가를 입력해주세요.';
      if (ex.cash === '') e.cash = '현재 현금 잔액을 입력해주세요 (없으면 0).';
    }
    if (!(Number(fee) >= 0)) e.fee = '수수료율은 0 이상이어야 합니다.';
    if (!(Number(tol) > 0)) e.tol = '허용 오차는 0보다 커야 합니다.';
    const clean = Object.fromEntries(Object.entries(e).filter(([, v]) => v));
    setErrors(clean);
    if (Object.keys(clean).length) return;
    await completeOnboarding({
      seedMoney: Number(seed),
      startDate,
      targets: weights,
      schedule,
      accountType,
      feeRatePct: Number(fee),
      tolerancePctPoint: Number(tol),
      notifyTime,
      remindDaysBefore: 7,
      existing: hasExisting
        ? {
            shares: { stock: Number(ex.stockShares), bond: Number(ex.bondShares) },
            avgPrice: { stock: ex.stockAvg ? Number(ex.stockAvg) : null, bond: ex.bondAvg ? Number(ex.bondAvg) : null },
            cash: Number(ex.cash || 0),
          }
        : null,
    });
    nav('/welcome');
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">기계적 리밸런싱 시작하기</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          규칙을 미리 정해두면, 앱이 정해진 날에 계산상 조정안을 보여드립니다. 실제 주문은 직접 하셔야 합니다.
        </p>
      </header>

      <Card title="이전에 쓰던 데이터가 있나요?">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          설정 화면에서 내려받은 백업 파일이 있으면 그대로 복원할 수 있습니다. 브라우저 데이터가 지워졌거나 다른 기기에서 열었을 때 사용하세요.
        </p>
        <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700">
          백업 파일로 복원
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importBackup(JSON.parse(await f.text()) as BackupFile);
                nav('/');
              } catch (err) {
                setErrors({ restore: (err as Error).message });
              }
            }}
          />
        </label>
        {errors.restore && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {errors.restore}</p>}
      </Card>

      <Card title="1. 투자금">
        <div className="space-y-3">
          <Field label="초기 시드머니" error={errors.seedMoney} hint="지금까지 넣은(또는 넣을) 원금 합계">
            <MoneyInput value={seed} onChange={setSeed} />
          </Field>
          <Field label="투자 시작일" error={errors.startDate}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="투자 통화">
            <Input value="원화 (KRW)" disabled />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasExisting} onChange={(e) => setHasExisting(e.target.checked)} />
            이미 ETF를 보유하고 있어요
          </label>
          {hasExisting && (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
              <Field label="S&P500 보유 수량(주)" error={errors['shares.stock']}>
                <Input inputMode="numeric" value={ex.stockShares} onChange={(e) => setEx({ ...ex, stockShares: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="평균 매입가(원)" error={errors.stockAvg}>
                <Input inputMode="numeric" value={ex.stockAvg} onChange={(e) => setEx({ ...ex, stockAvg: e.target.value.replace(/[^\d.]/g, '') })} />
              </Field>
              <Field label="미국채10년 보유 수량(주)" error={errors['shares.bond']}>
                <Input inputMode="numeric" value={ex.bondShares} onChange={(e) => setEx({ ...ex, bondShares: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="평균 매입가(원)" error={errors.bondAvg}>
                <Input inputMode="numeric" value={ex.bondAvg} onChange={(e) => setEx({ ...ex, bondAvg: e.target.value.replace(/[^\d.]/g, '') })} />
              </Field>
              <div className="col-span-2">
                <Field label="현재 현금 잔액" error={errors.cash}>
                  <MoneyInput value={ex.cash} onChange={(v) => setEx({ ...ex, cash: v })} />
                </Field>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title="2. 목표 자산 비중">
        <div className="grid grid-cols-3 gap-2">
          {(['stock', 'bond', 'cash'] as const).map((k) => (
            <Field key={k} label={k === 'stock' ? 'S&P500' : k === 'bond' ? '미국채10년' : '현금'}>
              <div className="relative">
                <Input inputMode="decimal" value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value.replace(/[^\d.]/g, '') })} className="pr-7 text-right" />
                <span className="absolute right-3 top-2 text-sm text-slate-500">%</span>
              </div>
            </Field>
          ))}
        </div>
        <div className="mt-2">
          {wc.ok ? <p className="text-sm text-emerald-700 dark:text-emerald-400">합계 100% ✓</p> : <Notice tone="warning">{wc.errors.join(' ')}</Notice>}
        </div>
        <p className="mt-2 text-xs text-slate-500">자동으로 맞춰드리지 않습니다. 합계가 정확히 100%가 되도록 직접 조정해주세요. 분석 화면에서 모델 참고 비중도 볼 수 있습니다.</p>
      </Card>

      <Card title="3. 리밸런싱 규칙">
        <div className="space-y-3">
          <ScheduleEditor value={schedule} onChange={setSchedule} error={errors.rebalanceMonths} />
          <Field
            label={<Term label="허용 오차 (±%p)">실제 비중이 목표에서 이만큼 이상 벗어나면 알림을 드립니다. 예: 목표 60%, 허용 오차 5 → 55~65%는 정상 범위.</Term>}
            error={errors.tol}
          >
            <Input inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="계좌 종류 (매매차익 세금 계산용)" hint={`일반 계좌는 매도 차익에 ${TAX_RATE_BY_ACCOUNT.general}% 과세(추정), 연금저축·IRP·ISA는 0%로 계산합니다.`}>
            <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
              <option value="general">일반 위탁계좌 (15.4%)</option>
              <option value="taxAdvantaged">연금저축 · IRP · ISA (0%, 과세이연)</option>
            </select>
          </Field>
          <Field label="매매 수수료율 (%)" hint="수수료 무료 혜택이 있으면 0" error={errors.fee}>
            <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="알림 시간" error={errors.notifyTime} hint="앱을 열었을 때 이 시간 이후면 그날 알림을 보여드립니다.">
            <Input type="time" value={notifyTime} onChange={(e) => setNotifyTime(e.target.value)} />
          </Field>
        </div>
      </Card>

      {Object.keys(errors).length > 0 && <Notice tone="warning">입력값을 확인해주세요. 표시된 항목을 고치면 저장할 수 있습니다.</Notice>}
      <Button className="w-full py-3" onClick={submit} disabled={!wc.ok}>
        저장하고 시작하기
      </Button>
      <Disclaimer />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

/** 온보딩 결과 요약 */
export function OnboardingSummary() {
  const nav = useNavigate();
  const app = useAppData();
  const s = app.settings!;
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <Card title="설정이 저장되었습니다">
        <dl className="space-y-2 text-sm">
          <Row k="자산배분 (목표)" v={`${s.assets.stock.name} ${s.targets.stock}% · ${s.assets.bond.name} ${s.targets.bond}% · 현금 ${s.targets.cash}%`} />
          <Row k="다음 리밸런싱 예정일" v={nextRebalanceDate(app.today, s.schedule)} />
          <Row k="추가 납입" v="정기 일정 없음 — 원할 때 대시보드의 [잔고에 돈 넣기] 버튼 사용" />
          <Row k="현재 잔고" v={`현금 ${formatWon(app.cash)}`} />
          <Row k="가격 데이터 마지막 확인" v={formatDateTime(app.market?.checkedAt)} />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FreshnessBadge f={app.freshness} isMock={app.market?.file?.isMock} />
          {app.lastPriceDate && <span className="text-xs text-slate-500">가격 기준일 {app.lastPriceDate}</span>}
        </div>
        {app.market?.error && <div className="mt-3"><Notice tone="warning">{app.market.error} 설정 화면에서 데이터 상태를 확인하거나 Mock 데이터로 먼저 사용해볼 수 있습니다.</Notice></div>}
        {app.freshness === 'stale' && <div className="mt-3"><Notice tone="warning">가격 데이터가 오래되어 최신 데이터가 아닐 수 있습니다.</Notice></div>}
        <Button className="mt-4 w-full" onClick={() => nav('/')}>
          대시보드로 이동
        </Button>
      </Card>
    </div>
  );
}
