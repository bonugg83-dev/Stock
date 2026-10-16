import { describe, expect, it } from 'vitest';
import { parseEtfResponse, parseFxResponse, fetchEtfHistory } from './sources.ts';
import { buildMarketFile, mergeHistory } from './merge.ts';

const etfJson = (items: unknown, totalCount = 2) => ({
  response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { totalCount, items: { item: items } } },
});

describe('공공데이터포털 ETF 응답 파싱', () => {
  it('종목코드가 정확히 일치하는 행만, 날짜 변환', () => {
    const { points } = parseEtfResponse(
      etfJson([
        { basDt: '20261015', srtnCd: '360750', clpr: '25010' },
        { basDt: '20261015', srtnCd: '3607501', clpr: '1' },
      ]),
      '360750',
    );
    expect(points).toEqual([{ date: '2026-10-15', close: 25010 }]);
  });
  it('item이 1개면 객체로 와도 처리', () => {
    expect(parseEtfResponse(etfJson({ basDt: '20261015', srtnCd: '305080', clpr: '12000' }, 1), '305080').points).toHaveLength(1);
  });
  it('API 오류 코드는 예외', () => {
    expect(() => parseEtfResponse({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } }, '1')).toThrow('30');
  });
  it('XML 오류 응답은 이해 가능한 예외', async () => {
    const f = (async () => new Response('<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</OpenAPI_ServiceResponse>')) as typeof fetch;
    await expect(fetchEtfHistory('360750', 'k', '2026-01-01', '2026-10-16', f)).rejects.toThrow('JSON이 아닌 응답');
  });
  it('미등록 키 403 응답은 사유를 알려준다', async () => {
    const f = (async () => new Response('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}', { status: 403 })) as typeof fetch;
    await expect(fetchEtfHistory('360750', 'k', '2026-01-01', '2026-10-16', f)).rejects.toThrow('등록되지 않은 서비스키');
  });
  it('HTTP 오류(가격 API 실패)', async () => {
    const f = (async () => new Response('x', { status: 500 })) as typeof fetch;
    await expect(fetchEtfHistory('360750', 'k', '2026-01-01', '2026-10-16', f)).rejects.toThrow('HTTP 500');
  });
});

describe('환율 응답 파싱', () => {
  it('날짜별 KRW', () => {
    expect(parseFxResponse({ rates: { '2026-10-15': { KRW: 1390.5 } } })).toEqual([{ date: '2026-10-15', close: 1390.5 }]);
  });
});

describe('병합', () => {
  it('같은 날짜는 새 값으로', () => {
    expect(mergeHistory([{ date: '2026-01-02', close: 1 }], [{ date: '2026-01-02', close: 2 }, { date: '2026-01-01', close: 3 }])).toEqual([
      { date: '2026-01-01', close: 3 },
      { date: '2026-01-02', close: 2 },
    ]);
  });
  it('수집 실패 시 마지막 성공 데이터와 시각을 유지하고 오류를 기록', () => {
    const prev = buildMarketFile(null, [{ id: 'A', name: 'A', unit: '원', source: 's', result: { ok: true, points: [{ date: '2026-10-14', close: 100 }] } }], '2026-10-15T08:00:00Z');
    const next = buildMarketFile(prev, [{ id: 'A', name: 'A', unit: '원', source: 's', result: { ok: false, error: 'HTTP 500' } }], '2026-10-16T08:00:00Z');
    expect(next.series.A.history).toHaveLength(1);
    expect(next.series.A.lastSuccessAt).toBe('2026-10-15T08:00:00Z');
    expect(next.series.A.error).toBe('HTTP 500');
  });
});
