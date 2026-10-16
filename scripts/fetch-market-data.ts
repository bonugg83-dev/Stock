/**
 * 가격·환율 수집기 (GitHub Actions에서 매 거래일 실행)
 *
 * 실행: node --experimental-strip-types scripts/fetch-market-data.ts
 * 환경변수:
 *   DATA_GO_KR_KEY  공공데이터포털 인증키 (Decoding 키). 코드에 직접 쓰지 말 것.
 *   PREV_MARKET_URL (선택) 이전에 배포된 market.json 주소. 실패 시 마지막 성공 데이터를 유지하는 데 사용.
 *   OUT_FILE        (선택) 출력 경로. 기본 public/data/market.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import assets from '../src/config/assets.json' with { type: 'json' };
import type { MarketFile } from '../src/data/marketTypes.ts';
import { ETF_SOURCE, FX_SOURCE, fetchEtfHistory, fetchUsdKrwHistory } from './collect/sources.ts';
import { buildMarketFile, type SeriesUpdate } from './collect/merge.ts';

const OUT = process.env.OUT_FILE ?? 'public/data/market.json';

const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const minusDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

async function loadPrevious(): Promise<MarketFile | null> {
  const url = process.env.PREV_MARKET_URL;
  if (url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return (await res.json()) as MarketFile;
      console.warn(`이전 데이터(${url}) 응답: HTTP ${res.status}`);
    } catch (e) {
      console.warn(`이전 데이터를 불러오지 못함: ${(e as Error).message}`);
    }
  }
  try {
    return JSON.parse(await readFile(OUT, 'utf8')) as MarketFile;
  } catch {
    return null;
  }
}

/** 이전 데이터가 있으면 최근 30일만, 없으면 전체 기간을 받는다 */
function beginDate(prev: MarketFile | null, id: string): string {
  const h = prev && !prev.isMock ? prev.series[id]?.history : undefined;
  if (h && h.length) return minusDays(h[h.length - 1].date, 30);
  return assets.historyStart;
}

async function attempt(fn: () => Promise<SeriesUpdate['result']>): Promise<SeriesUpdate['result']> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function main() {
  const prev = await loadPrevious();
  const end = todayKst();
  const key = process.env.DATA_GO_KR_KEY;
  const updates: SeriesUpdate[] = [];

  for (const a of [assets.stock, assets.bond]) {
    const result: SeriesUpdate['result'] = key
      ? await attempt(async () => ({ ok: true, points: await fetchEtfHistory(a.code, key, beginDate(prev, a.code), end) }))
      : { ok: false, error: 'DATA_GO_KR_KEY 환경변수(GitHub Secrets)가 설정되지 않았습니다.' };
    updates.push({ id: a.code, name: a.name, unit: '원/주', source: ETF_SOURCE, result });
  }

  const fx = await attempt(async () => ({ ok: true, points: await fetchUsdKrwHistory(beginDate(prev, 'USDKRW'), end) }));
  updates.push({ id: 'USDKRW', name: 'USD/KRW 환율', unit: '원/달러', source: FX_SOURCE, result: fx });

  const file = buildMarketFile(prev, updates, new Date().toISOString());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(file));

  for (const s of Object.values(file.series)) {
    const last = s.history[s.history.length - 1];
    console.log(`${s.name}: ${s.history.length}개, 마지막 ${last ? `${last.date} ${last.close}` : '없음'}${s.error ? ` / 오류: ${s.error}` : ''}`);
  }
  // 오류가 있어도 마지막 성공 데이터로 배포는 계속한다 (앱이 오류를 표시)
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
