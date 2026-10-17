import { useEffect, useState } from 'react';
import { useAppData } from '../../app/AppData';
import { importBackup, resetAll, TAX_RATE_BY_ACCOUNT, updateSettings, type BackupFile } from '../../db/repo';
import { downloadBackup, isStoragePersisted, lastBackupAt, requestPersistentStorage } from '../../db/backupFile';
import type { AccountType, UserSettings } from '../../db/schema';
import { validateWeights } from '../../engine/validation';
import type { RebalanceSchedule } from '../../engine/schedule';
import { Button, Card, Disclaimer, Field, FreshnessBadge, Input, Modal, Notice, formatDateTime } from '../components/ui';
import { ScheduleEditor } from '../components/ScheduleEditor';
import { useSync } from '../../sync/SyncProvider';

export default function Settings() {
  const app = useAppData();
  const sync = useSync();
  const [projectId, setProjectId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const s = app.settings!;
  const [w, setW] = useState({ stock: String(s.targets.stock), bond: String(s.targets.bond), cash: String(s.targets.cash) });
  const [schedule, setSchedule] = useState<RebalanceSchedule>(s.schedule);
  const [tol, setTol] = useState(String(s.tolerancePctPoint));
  const [fee, setFee] = useState(String(s.feeRatePct));
  const [account, setAccount] = useState<AccountType>(s.accountType);
  const [mode, setMode] = useState(s.rebalanceMode);
  const [notifyTime, setNotifyTime] = useState(s.notifyTime);
  const [remind, setRemind] = useState(String(s.remindDaysBefore));
  const [rf, setRf] = useState(String(s.riskFreeRatePct));
  const [codes, setCodes] = useState({ stock: s.assets.stock.code, bond: s.assets.bond.code });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [last, setLast] = useState<string | null>(lastBackupAt());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    isStoragePersisted().then(setPersisted);
  }, []);

  const weights = { stock: Number(w.stock), bond: Number(w.bond), cash: Number(w.cash) };
  const wc = validateWeights(weights);

  const save = async () => {
    setErr(null);
    if (!wc.ok) return setErr(wc.errors.join(' '));
    if (!(Number(tol) > 0)) return setErr('허용 오차는 0보다 커야 합니다.');
    if (!(Number(fee) >= 0)) return setErr('수수료율은 0 이상이어야 합니다.');
    if (schedule.type === 'firstTradingDay' ? schedule.months.length === 0 : schedule.dates.length === 0) return setErr('리밸런싱 기준일을 1개 이상 지정해주세요.');
    if (!/^\d{6}$/.test(codes.stock) || !/^\d{6}$/.test(codes.bond)) return setErr('종목코드는 6자리 숫자입니다.');
    const patch: Partial<UserSettings> = {
      targets: weights,
      schedule,
      tolerancePctPoint: Number(tol),
      feeRatePct: Number(fee),
      accountType: account,
      taxRatePct: TAX_RATE_BY_ACCOUNT[account],
      rebalanceMode: mode,
      notifyTime,
      remindDaysBefore: Math.max(0, Math.round(Number(remind))),
      riskFreeRatePct: Number(rf),
      assets: { stock: { ...s.assets.stock, code: codes.stock }, bond: { ...s.assets.bond, code: codes.bond } },
    };
    const changed = (Object.keys(patch) as (keyof UserSettings)[]).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(s[k]));
    if (!changed.length) return setMsg('변경된 내용이 없습니다.');
    const p = Object.fromEntries(changed.map((k) => [k, patch[k]])) as Partial<UserSettings>;
    await updateSettings(p, `설정 변경: ${changed.join(', ')}`);
    setMsg('저장했습니다. 변경 이력은 기록 화면에서 볼 수 있습니다.');
  };

  const download = async () => {
    await downloadBackup(app.today);
    setLast(lastBackupAt());
  };

  const upload = async (file: File) => {
    try {
      await importBackup(JSON.parse(await file.text()) as BackupFile);
      setMsg('백업을 복원했습니다.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const market = app.market;
  return (
    <div className="space-y-4">
      <Card title="데이터 제공처 상태" actions={<FreshnessBadge f={app.freshness} isMock={market?.file?.isMock} />}>
        <div className="space-y-2 text-sm">
          <div className="flex gap-4">
            <label className="flex items-center gap-1">
              <input type="radio" checked={s.dataSource === 'live'} onChange={() => updateSettings({ dataSource: 'live' }, '데이터: 실제 데이터')} /> 실제 데이터
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={s.dataSource === 'mock'} onChange={() => updateSettings({ dataSource: 'mock' }, '데이터: Mock')} /> Mock (가상) 데이터
            </label>
          </div>
          {market?.error && <Notice tone="warning">{market.error}</Notice>}
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {market?.file &&
              Object.values(market.file.series).map((x) => (
                <li key={x.id}>
                  <b>{x.name}</b>: {x.history.length}일치 · 마지막 {x.history.at(-1)?.date ?? '—'} · 수집 성공 {formatDateTime(x.lastSuccessAt)} · {x.source}
                  {x.error && <span className="text-amber-700 dark:text-amber-400"> · 오류: {x.error}</span>}
                </li>
              ))}
          </ul>
          <p className="text-xs text-slate-500">
            파일 생성 {formatDateTime(market?.file?.generatedAt)} · 앱에서 확인 {formatDateTime(market?.checkedAt)}. 실제 데이터는 GitHub Actions가 거래일마다 수집합니다 (README 참고).
          </p>
        </div>
      </Card>

      <Card title="투자 규칙">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(['stock', 'bond', 'cash'] as const).map((k) => (
              <Field key={k} label={`${k === 'stock' ? '주식' : k === 'bond' ? '채권' : '현금'} 목표 %`}>
                <Input inputMode="decimal" value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
              </Field>
            ))}
          </div>
          {!wc.ok && <Notice tone="warning">{wc.errors.join(' ')}</Notice>}
          <ScheduleEditor value={schedule} onChange={setSchedule} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="허용 오차 (±%p)">
              <Input inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} />
            </Field>
            <Field label="기본 리밸런싱 방식">
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="cashFirst">현금 우선형</option>
                <option value="full">매매형</option>
              </select>
            </Field>
            <Field label="매매 수수료율 (%)">
              <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="계좌 종류 (세율)">
              <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={account} onChange={(e) => setAccount(e.target.value as AccountType)}>
                <option value="general">일반 위탁 (15.4%)</option>
                <option value="taxAdvantaged">연금·IRP·ISA (0%)</option>
              </select>
            </Field>
            <Field label="알림 시간">
              <Input type="time" value={notifyTime} onChange={(e) => setNotifyTime(e.target.value)} />
            </Field>
            <Field label="리밸런싱 며칠 전 알림">
              <Input inputMode="numeric" value={remind} onChange={(e) => setRemind(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Field label="무위험수익률 (%/년)" hint="CAPM·샤프지수 계산용 (예: 국고채 3년 금리)">
              <Input inputMode="decimal" value={rf} onChange={(e) => setRf(e.target.value)} />
            </Field>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">종목코드 (관리자 설정)</summary>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label={`주식 · ${s.assets.stock.name}`}>
                <Input value={codes.stock} onChange={(e) => setCodes({ ...codes, stock: e.target.value.trim() })} />
              </Field>
              <Field label={`채권 · ${s.assets.bond.name}`}>
                <Input value={codes.bond} onChange={(e) => setCodes({ ...codes, bond: e.target.value.trim() })} />
              </Field>
            </div>
            <p className="mt-1 text-xs text-slate-500">수집기가 받는 종목은 저장소의 src/config/assets.json에서 정합니다. 여기서만 바꾸면 가격이 없을 수 있습니다.</p>
          </details>
          {err && <Notice tone="warning">{err}</Notice>}
          {msg && <Notice>{msg}</Notice>}
          <div className="flex justify-end">
            <Button onClick={save}>설정 저장</Button>
          </div>
        </div>
      </Card>

      <Card title="기기 간 동기화 (폰·태블릿·PC 같은 데이터)">
        {sync.enabled ? (
          <div className="space-y-2 text-sm">
            <p>
              상태: <b>{sync.status === 'idle' ? '연결됨 · 동기화됨' : sync.status === 'syncing' ? '동기화 중…' : sync.status === 'conflict' ? '선택 필요' : '오류'}</b> · 프로젝트 {sync.projectId}
            </p>
            <p className="text-xs text-slate-500">마지막 동기화 {formatDateTime(sync.lastSyncedAt)}. 데이터를 바꾸면 몇 초 안에 자동으로 올라가고, 다른 기기에서 앱을 열거나 다시 보면 자동으로 받아옵니다.</p>
            {sync.error && <Notice tone="warning">{sync.error}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void sync.syncNow()}>지금 동기화</Button>
              <Button variant="ghost" onClick={sync.clearConnection}>이 기기 연결 정보 지우기</Button>
            </div>
            <p className="text-xs text-slate-500">로그인이 없습니다. 같은 서버를 쓰는 모든 기기가 한 사람의 데이터를 공유하는 구조입니다.</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <Notice>동기화가 꺼져 있어 이 브라우저에만 저장됩니다. README의 "기기 간 동기화 켜기"대로 Firebase를 만든 뒤 아래에 입력하세요.</Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Firebase 프로젝트 ID">
                <Input value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="예: my-rebalance-1234" />
              </Field>
              <Field label="웹 API 키">
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza..." />
              </Field>
            </div>
            <Button disabled={!projectId.trim() || !apiKey.trim()} onClick={() => sync.saveConnection(projectId, apiKey)}>
              연결하고 이 기기에서 시작
            </Button>
            <p className="text-xs text-slate-500">여기에 입력하면 이 기기에만 저장됩니다. 저장소 설정 파일(src/config/sync.json)에 넣으면 모든 기기가 자동으로 연결됩니다.</p>
          </div>
        )}
      </Card>

      <Card title="백업 · 초기화">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          모든 기록은 이 브라우저 안에만 저장됩니다. 브라우저 데이터를 지우면 사라지므로 정기적으로 백업 파일을 내려받으세요. 다른 기기로 옮길 때도 사용합니다.
        </p>
        <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
          <li>마지막 백업: {last ? formatDateTime(last) : '없음'}</li>
          <li>
            브라우저 저장 보호: {persisted === null ? '확인 불가' : persisted ? '켜짐 (브라우저가 임의로 지우지 않음)' : '꺼짐'}
            {persisted === false && (
              <>
                {' '}
                <button className="underline" onClick={async () => setPersisted(await requestPersistentStorage())}>
                  보호 요청하기
                </button>
              </>
            )}
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={download}>백업 파일 내려받기</Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700">
            백업 파일로 복원
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <Button variant="danger" onClick={() => setResetOpen(true)}>데이터 초기화</Button>
        </div>
      </Card>
      <Disclaimer />

      {resetOpen && (
        <Modal title="데이터를 모두 지울까요?" onClose={() => setResetOpen(false)}>
          <div className="space-y-3 text-sm">
            <p>설정·보유 수량·납입·계산 기록이 모두 삭제되고 처음 설정 화면으로 돌아갑니다. 되돌릴 수 없으니 먼저 백업 파일을 내려받으세요.</p>
            {sync.enabled && <Notice tone="warning">동기화가 켜져 있어 <b>다른 기기와 서버의 데이터도 모두 지워집니다.</b></Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setResetOpen(false)}>취소</Button>
              <Button variant="secondary" onClick={download}>백업 먼저 받기</Button>
              <Button onClick={async () => { await resetAll(); await sync.afterLocalReset(); setResetOpen(false); }}>모두 삭제</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
