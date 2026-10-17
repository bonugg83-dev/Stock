/** 서버에 저장된 데이터 한 덩어리 (모든 기록을 JSON 문자열 하나로) */
export interface Snapshot {
  /** 저장될 때마다 1씩 증가하는 번호 */
  rev: number;
  /** 백업 JSON. 빈 문자열이면 "초기화됨" */
  json: string;
  /** 서버가 기록한 마지막 수정 시각 (동시 수정 감지에 사용) */
  updateTime: string;
}

export type Precondition = { exists: false } | { updateTime: string };

export interface Remote {
  get(): Promise<Snapshot | null>;
  /** 다른 기기가 먼저 저장했으면 ConflictError */
  put(json: string, rev: number, pre: Precondition): Promise<{ updateTime: string }>;
}

export class ConflictError extends Error {
  constructor() {
    super('다른 기기가 먼저 저장했습니다');
    this.name = 'ConflictError';
  }
}

export interface SyncState {
  /** 마지막으로 맞춘 서버 번호 */
  rev: number;
  /** 서버에 아직 못 올린 변경이 있는지 */
  dirty: boolean;
  updateTime: string | null;
  lastSyncedAt: string | null;
  /** 이 기기에서 "초기화"를 했고 서버에 아직 반영 전 */
  cleared: boolean;
}

export interface StateStore {
  get(): SyncState | null;
  set(s: SyncState): void;
}

export const EMPTY_STATE: SyncState = { rev: 0, dirty: false, updateTime: null, lastSyncedAt: null, cleared: false };
