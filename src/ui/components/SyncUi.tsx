import { downloadBackup } from '../../db/backupFile';
import { formatWon } from '../../engine/money';
import { useAppData } from '../../app/AppData';
import { useSync, type SyncStatus } from '../../sync/SyncProvider';
import type { Summary } from '../../sync/engine';
import { Button, Modal, Notice, formatDateTime } from './ui';

const LABEL: Record<SyncStatus, string> = {
  off: '동기화 꺼짐',
  idle: '동기화됨',
  syncing: '동기화 중…',
  error: '동기화 오류',
  conflict: '선택 필요',
};

/** 헤더의 작은 상태 표시 */
export function SyncBadge() {
  const s = useSync();
  if (!s.enabled) return null;
  const warn = s.status === 'error' || s.status === 'conflict';
  return (
    <button
      onClick={() => void s.syncNow()}
      title={s.error ?? `마지막 동기화 ${formatDateTime(s.lastSyncedAt)} (누르면 지금 동기화)`}
      className={`rounded-lg px-2 py-1 text-xs ${warn ? 'bg-amber-400 font-semibold text-slate-900' : 'bg-white/10'}`}
    >
      ☁ {LABEL[s.status]}
    </button>
  );
}

const Box = ({ title, s, onPick, label }: { title: string; s: Summary; onPick: () => void; label: string }) => (
  <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
    <p className="font-semibold">{title}</p>
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
      <li>기록 {s.ledgerCount}건</li>
      <li>현금 흐름 합계 {formatWon(s.cash)}</li>
      <li>마지막 변경 {formatDateTime(s.lastChange)}</li>
    </ul>
    <Button className="mt-3 w-full" onClick={onPick}>
      {label}
    </Button>
  </div>
);

/** 두 기기의 데이터가 서로 다를 때 어느 쪽을 쓸지 고르는 창 */
export function ConflictModal() {
  const s = useSync();
  const app = useAppData();
  if (!s.conflict) return null;
  return (
    <Modal title="어느 데이터를 사용할까요?" onClose={() => undefined}>
      <div className="space-y-3">
        <Notice tone="warning">
          이 기기와 서버(다른 기기)에 저장된 데이터가 서로 다릅니다. 고르지 않은 쪽은 덮어써집니다. 걱정되면 먼저 이 기기 백업을 받아두세요.
        </Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Box title="서버 (다른 기기에서 저장)" s={s.conflict.remote} label="서버 데이터 사용" onPick={() => void s.resolve('remote')} />
          <Box title="이 기기" s={s.conflict.local} label="이 기기 데이터 사용" onPick={() => void s.resolve('local')} />
        </div>
        <Button variant="secondary" onClick={() => void downloadBackup(app.today)}>
          이 기기 백업 먼저 받기
        </Button>
      </div>
    </Modal>
  );
}
