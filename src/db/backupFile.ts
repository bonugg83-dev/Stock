import { exportBackup } from './repo';

const LAST_BACKUP_KEY = 'rebalance-last-backup';
const SNOOZE_KEY = 'rebalance-backup-snooze';
const DAY = 24 * 3600 * 1000;

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // 시크릿 모드 등에서는 접근이 막힐 수 있다
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장 실패는 무시 */
  }
};

export async function downloadBackup(today: string): Promise<void> {
  const b = await exportBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `rebalance-backup-${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
  write(LAST_BACKUP_KEY, new Date().toISOString());
}

export function lastBackupAt(): string | null {
  return read(LAST_BACKUP_KEY);
}

/** 백업이 없거나 30일이 지났고, 최근 7일 안에 "나중에"를 누르지 않았으면 안내 */
export function shouldRemindBackup(now = Date.now()): boolean {
  const last = read(LAST_BACKUP_KEY);
  const snooze = read(SNOOZE_KEY);
  if (snooze && now - Date.parse(snooze) < 7 * DAY) return false;
  return !last || now - Date.parse(last) > 30 * DAY;
}

export function snoozeBackupReminder() {
  write(SNOOZE_KEY, new Date().toISOString());
}

/** 브라우저가 저장 공간을 임의로 지우지 않도록 요청 (허용 여부는 브라우저가 결정) */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}
