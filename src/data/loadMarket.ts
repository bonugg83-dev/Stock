import { db } from '../db/db';
import type { MarketFile } from './marketTypes';
import { buildMockMarket } from './mock';

export interface MarketLoadResult {
  file: MarketFile | null;
  /** 이번 불러오기의 오류 (마지막 성공 데이터를 대신 보여주는 경우 포함) */
  error: string | null;
  /** 브라우저에 저장된 마지막 성공 데이터를 쓰는 중인지 */
  fromCache: boolean;
  checkedAt: string;
}

export interface MarketSourceOptions {
  source: 'live' | 'mock';
  codes: { stock: string; bond: string; stockName: string; bondName: string };
}

/** 데이터 제공처와 계산 로직을 분리: 화면은 이 함수 결과만 사용한다 */
export async function loadMarket(opts: MarketSourceOptions, fetchFn: typeof fetch = fetch): Promise<MarketLoadResult> {
  const checkedAt = new Date().toISOString();
  if (opts.source === 'mock') {
    return { file: buildMockMarket(opts.codes), error: null, fromCache: false, checkedAt };
  }
  try {
    const res = await fetchFn(`./data/market.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) throw new Error('가격 데이터 파일이 아직 없습니다 (수집기가 아직 실행되지 않았을 수 있음)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let file: MarketFile;
    try {
      file = (await res.json()) as MarketFile;
    } catch {
      throw new Error('가격 데이터 파일이 없거나 형식이 올바르지 않습니다');
    }
    if (file.schemaVersion !== 1 || !file.series) throw new Error('가격 데이터 형식이 올바르지 않습니다.');
    await db.meta.put({ key: 'lastMarket', value: file, savedAt: checkedAt }).catch(() => undefined);
    return { file, error: null, fromCache: false, checkedAt };
  } catch (e) {
    const cached = await db.meta.get('lastMarket').catch(() => undefined);
    return {
      file: cached?.value ?? null,
      error: `가격 데이터를 불러오지 못했습니다: ${(e as Error).message}`,
      fromCache: !!cached,
      checkedAt,
    };
  }
}
