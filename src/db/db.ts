import Dexie, { type Table } from 'dexie';
import type {
  CashLedgerEntry,
  DistributionRecord,
  Holding,
  MetaEntry,
  NotificationRecord,
  RebalanceRecord,
  SettingsHistoryEntry,
  UserSettings,
} from './schema';

/** 브라우저 안(IndexedDB)에 저장. 서버로 전송하지 않는다. */
export class AppDB extends Dexie {
  settings!: Table<UserSettings, string>;
  holdings!: Table<Holding, string>;
  ledger!: Table<CashLedgerEntry, number>;
  rebalances!: Table<RebalanceRecord, number>;
  distributions!: Table<DistributionRecord, number>;
  notifications!: Table<NotificationRecord, string>;
  settingsHistory!: Table<SettingsHistoryEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'rebalance-app') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      holdings: 'asset',
      ledger: '++id, date, type, groupId',
      rebalances: '++id, calculatedAt, kind',
      distributions: '++id, asset, recordDate, status',
      notifications: 'key, createdAt',
      settingsHistory: '++id, changedAt',
      meta: 'key',
    });
  }
}

export const db = new AppDB();
