import { describe, expect, it } from 'vitest';
import { createFirestoreRemote } from './remote';
import { ConflictError } from './types';

const cfg = { projectId: 'my-proj', apiKey: 'AIza-test', endpoint: 'https://fs.test', collection: 'app', docId: 'main' };
const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('Firestore REST', () => {
  it('문서를 읽어 rev/json/updateTime으로 변환', async () => {
    let url = '';
    const f = (async (u: string) => {
      url = u;
      return res(200, { updateTime: '2026-10-17T00:00:00Z', fields: { rev: { integerValue: '4' }, json: { stringValue: '{"a":1}' } } });
    }) as unknown as typeof fetch;
    const snap = await createFirestoreRemote(cfg, f).get();
    expect(snap).toEqual({ rev: 4, json: '{"a":1}', updateTime: '2026-10-17T00:00:00Z' });
    expect(url).toBe('https://fs.test/v1/projects/my-proj/databases/(default)/documents/app/main?key=AIza-test');
  });

  it('문서가 없으면 null, 데이터베이스가 없으면 안내 오류', async () => {
    const none = (async () => res(404, { error: { message: 'Document "projects/p/databases/(default)/documents/app/main" not found.' } })) as unknown as typeof fetch;
    expect(await createFirestoreRemote(cfg, none).get()).toBeNull();
    const nodb = (async () => res(404, { error: { message: 'The database (default) does not exist for project my-proj' } })) as unknown as typeof fetch;
    await expect(createFirestoreRemote(cfg, nodb).get()).rejects.toThrow('데이터베이스가 만들어지지 않았습니다');
  });

  it('쓰기: 마스크·조건·본문 형식', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const f = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return res(200, { updateTime: 'T2' });
    }) as unknown as typeof fetch;
    const r = createFirestoreRemote(cfg, f);
    expect(await r.put('{"x":1}', 3, { updateTime: '2026-10-17T00:00:00.123Z' })).toEqual({ updateTime: 'T2' });
    expect(url).toContain('updateMask.fieldPaths=rev&updateMask.fieldPaths=json');
    expect(url).toContain('currentDocument.updateTime=2026-10-17T00%3A00%3A00.123Z');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init!.body as string)).toEqual({ fields: { rev: { integerValue: '3' }, json: { stringValue: '{"x":1}' } } });
    await r.put('', 1, { exists: false });
    expect(url).toContain('currentDocument.exists=false');
  });

  it('조건 불일치(409, FAILED_PRECONDITION)는 충돌, 403은 규칙 안내', async () => {
    const mk = (status: number, body: string) => (async () => res(status, body)) as unknown as typeof fetch;
    await expect(createFirestoreRemote(cfg, mk(409, '{}')).put('x', 2, { exists: false })).rejects.toBeInstanceOf(ConflictError);
    await expect(createFirestoreRemote(cfg, mk(400, '{"error":{"status":"FAILED_PRECONDITION"}}')).put('x', 2, { updateTime: 't' })).rejects.toBeInstanceOf(ConflictError);
    await expect(createFirestoreRemote(cfg, mk(403, '{}')).put('x', 2, { updateTime: 't' })).rejects.toThrow('보안 규칙');
  });
});
