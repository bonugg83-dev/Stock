import type { SeriesPoint } from '../../src/data/marketTypes.ts';

/**
 * 공식 데이터 제공처 (크롤링 없음)
 *
 * 1) 공공데이터포털 - 금융위원회_증권상품시세정보 (ETF 일별 시세)
 *    - 무료, 인증키 필요 (환경변수 DATA_GO_KR_KEY, GitHub Secrets에 저장)
 *    - 전 거래일 종가 기준 (다음 영업일 오후에 갱신)
 * 2) Frankfurter (유럽중앙은행 ECB 기준환율) - USD/KRW
 *    - 무료, 키 필요 없음
 *    - ECB 영업일 기준 1일 1회, 한국 은행 매매기준율과 약간 다를 수 있음
 */

export const ETF_ENDPOINT =
  'https://apis.data.go.kr/1160100/service/GetSecuritiesProductInfoService/getETFPriceInfo';
export const FX_ENDPOINT = 'https://api.frankfurter.dev/v1';

export const ETF_SOURCE = '공공데이터포털 금융위원회 증권상품시세정보 (KRX)';
export const FX_SOURCE = 'Frankfurter (유럽중앙은행 기준환율)';

const compact = (date: string) => date.replaceAll('-', '');
const expand = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

type FetchFn = typeof fetch;

/** 공공데이터포털 응답에서 해당 종목의 (날짜, 종가)만 추출 */
export function parseEtfResponse(json: unknown, code: string): { points: SeriesPoint[]; totalCount: number } {
  const body = (json as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; items?: { item?: unknown } } } })
    ?.response;
  if (!body) throw new Error('응답 형식이 예상과 다릅니다 (response 없음)');
  if (body.header?.resultCode && body.header.resultCode !== '00') {
    throw new Error(`API 오류 ${body.header.resultCode}: ${body.header.resultMsg ?? ''}`);
  }
  const raw = body.body?.items?.item;
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw ? [raw as Record<string, unknown>] : [];
  const points: SeriesPoint[] = [];
  for (const it of items) {
    if (String(it.srtnCd) !== code) continue;
    const close = Number(it.clpr);
    const basDt = String(it.basDt ?? '');
    if (!/^\d{8}$/.test(basDt) || !Number.isFinite(close) || close <= 0) continue;
    points.push({ date: expand(basDt), close });
  }
  return { points, totalCount: Number(body.body?.totalCount ?? 0) };
}

export async function fetchEtfHistory(
  code: string,
  serviceKey: string,
  begin: string,
  end: string,
  fetchFn: FetchFn = fetch,
): Promise<SeriesPoint[]> {
  const out: SeriesPoint[] = [];
  const numOfRows = 1000;
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({
      serviceKey,
      resultType: 'json',
      likeSrtnCd: code,
      beginBasDt: compact(begin),
      endBasDt: compact(end),
      numOfRows: String(numOfRows),
      pageNo: String(page),
    });
    const res = await fetchFn(`${ETF_ENDPOINT}?${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // 인증키 오류 등은 XML로 응답하는 경우가 있다
      throw new Error(`JSON이 아닌 응답: ${text.slice(0, 200)}`);
    }
    const { points, totalCount } = parseEtfResponse(json, code);
    out.push(...points);
    if (page * numOfRows >= totalCount) break;
  }
  return out;
}

export function parseFxResponse(json: unknown): SeriesPoint[] {
  const rates = (json as { rates?: Record<string, { KRW?: number }> })?.rates;
  if (!rates || typeof rates !== 'object') throw new Error('환율 응답 형식이 예상과 다릅니다 (rates 없음)');
  return Object.entries(rates)
    .filter(([date, r]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(r?.KRW) && r.KRW! > 0)
    .map(([date, r]) => ({ date, close: r.KRW! }));
}

export async function fetchUsdKrwHistory(begin: string, end: string, fetchFn: FetchFn = fetch): Promise<SeriesPoint[]> {
  const res = await fetchFn(`${FX_ENDPOINT}/${begin}..${end}?base=USD&symbols=KRW`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFxResponse(await res.json());
}
