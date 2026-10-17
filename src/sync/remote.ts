import { ConflictError, type Remote, type Snapshot } from './types';

export interface SyncConfig {
  projectId: string;
  apiKey: string;
  endpoint: string;
  collection: string;
  docId: string;
}

/**
 * Firestore REST API로 문서 하나(app/main)를 읽고 쓴다. 별도 SDK 없이 fetch만 사용.
 * 문서 필드: rev(정수), json(문자열)
 */
export function createFirestoreRemote(cfg: SyncConfig, fetchFn: typeof fetch = fetch): Remote {
  const base = `${cfg.endpoint}/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents/${cfg.collection}/${cfg.docId}`;
  const key = `key=${encodeURIComponent(cfg.apiKey)}`;

  const explain = (status: number, text: string): string => {
    if (status === 403) return 'Firestore 보안 규칙이 접근을 막고 있습니다 (firestore.rules 내용을 규칙에 붙여넣었는지 확인)';
    if (status === 400 && /API key/i.test(text)) return 'API 키가 올바르지 않습니다';
    if (status === 404 || /does not exist/i.test(text)) return 'Firestore 데이터베이스가 만들어지지 않았습니다';
    if (status === 429) return '요청 한도를 초과했습니다 (잠시 뒤 다시 시도)';
    return `HTTP ${status} ${text.slice(0, 120)}`;
  };

  return {
    async get(): Promise<Snapshot | null> {
      const res = await fetchFn(`${base}?${key}`, { cache: 'no-store' });
      if (res.status === 404) {
        const text = await res.text();
        if (/database .*does not exist/i.test(text)) throw new Error(explain(404, text));
        return null; // 문서가 아직 없음
      }
      if (!res.ok) throw new Error(explain(res.status, await res.text()));
      const doc = (await res.json()) as { updateTime?: string; fields?: { rev?: { integerValue?: string }; json?: { stringValue?: string } } };
      return {
        rev: Number(doc.fields?.rev?.integerValue ?? 0),
        json: doc.fields?.json?.stringValue ?? '',
        updateTime: doc.updateTime ?? '',
      };
    },

    async put(json, rev, pre) {
      const cond = 'exists' in pre ? 'currentDocument.exists=false' : `currentDocument.updateTime=${encodeURIComponent(pre.updateTime)}`;
      const url = `${base}?updateMask.fieldPaths=rev&updateMask.fieldPaths=json&${cond}&${key}`;
      const res = await fetchFn(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { rev: { integerValue: String(rev) }, json: { stringValue: json } } }),
      });
      if (res.status === 409) throw new ConflictError();
      if (!res.ok) {
        const text = await res.text();
        if (/FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED/.test(text)) throw new ConflictError();
        throw new Error(explain(res.status, text));
      }
      const doc = (await res.json()) as { updateTime?: string };
      return { updateTime: doc.updateTime ?? '' };
    },
  };
}
