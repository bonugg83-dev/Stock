import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CashLedgerEntry, Holding, UserSettings } from '../db/schema';
import { cashFromLedger, netContribution } from '../db/repo';
import { loadMarket, type MarketLoadResult } from '../data/loadMarket';
import { FX_ID, latestQuote, type Quote, type SeriesPoint } from '../data/marketTypes';
import { evaluateFreshness, type Freshness } from '../engine/freshness';
import { valuePortfolio, type Valuation } from '../engine/portfolio';
import { nextRebalanceDate, todayKst } from '../engine/schedule';
import type { Dec } from '../engine/money';
import type { PortfolioState, RiskyAsset } from '../engine/types';

export interface AppData {
  ready: boolean;
  settings: UserSettings | null;
  holdings: Record<RiskyAsset, Holding>;
  ledger: CashLedgerEntry[];
  cash: Dec;
  contribution: Dec;
  market: MarketLoadResult | null;
  marketLoading: boolean;
  reloadMarket: () => void;
  quotes: { stock: Quote | null; bond: Quote | null; fx: Quote | null };
  history: Record<RiskyAsset | 'fx', SeriesPoint[]>;
  freshness: Freshness;
  lastPriceDate: string | null;
  portfolioState: PortfolioState;
  /** 가격이 없으면 null (임의의 0을 보여주지 않음) */
  valuation: Valuation | null;
  today: string;
  nextRebalance: string | null;
}

const Ctx = createContext<AppData | null>(null);

const emptyHolding = (asset: RiskyAsset): Holding => ({ asset, shares: 0, avgPrice: null, costBasis: 0, asOf: '' });

export function AppDataProvider({ children }: { children: ReactNode }) {
  // 설정이 없으면 null, 아직 읽는 중이면 undefined
  const settings = useLiveQuery(async () => (await db.settings.get('main')) ?? null, [], undefined);
  const holdingRows = useLiveQuery(() => db.holdings.toArray(), [], undefined);
  const ledger = useLiveQuery(() => db.ledger.toArray(), [], undefined);
  const [market, setMarket] = useState<MarketLoadResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const today = todayKst();

  const source = settings?.dataSource ?? 'live';
  const stockCode = settings?.assets.stock.code;
  const bondCode = settings?.assets.bond.code;
  useEffect(() => {
    if (settings === undefined) return;
    let alive = true;
    setMarketLoading(true);
    const s = settings ?? null;
    loadMarket({
      source,
      codes: {
        stock: stockCode ?? '360750',
        bond: bondCode ?? '305080',
        stockName: s?.assets.stock.name ?? '주식',
        bondName: s?.assets.bond.name ?? '채권',
      },
    }).then((r) => {
      if (alive) {
        setMarket(r);
        setMarketLoading(false);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, stockCode, bondCode, nonce, settings === undefined]);

  const reloadMarket = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo<AppData>(() => {
    const holdings = {
      stock: holdingRows?.find((h) => h.asset === 'stock') ?? emptyHolding('stock'),
      bond: holdingRows?.find((h) => h.asset === 'bond') ?? emptyHolding('bond'),
    };
    const led = ledger ?? [];
    const cash = cashFromLedger(led);
    const file = market?.file ?? null;
    const sStock = stockCode ? file?.series[stockCode] : undefined;
    const sBond = bondCode ? file?.series[bondCode] : undefined;
    const sFx = file?.series[FX_ID];
    const quotes = { stock: latestQuote(sStock), bond: latestQuote(sBond), fx: latestQuote(sFx) };
    const lastPriceDate = [quotes.stock?.date, quotes.bond?.date].filter(Boolean).sort()[0] ?? null;
    const freshness =
      quotes.stock && quotes.bond ? evaluateFreshness(lastPriceDate, today, settings?.staleAfterBusinessDays ?? 2) : 'missing';
    const portfolioState: PortfolioState = {
      shares: { stock: holdings.stock.shares, bond: holdings.bond.shares },
      cash,
      avgPrice: { stock: holdings.stock.avgPrice, bond: holdings.bond.avgPrice },
    };
    let valuation: Valuation | null = null;
    if (quotes.stock && quotes.bond) {
      valuation = valuePortfolio(portfolioState, { stock: quotes.stock.close, bond: quotes.bond.close });
    }
    return {
      ready: settings !== undefined && holdingRows !== undefined && ledger !== undefined,
      settings: settings ?? null,
      holdings,
      ledger: led,
      cash,
      contribution: netContribution(led),
      market,
      marketLoading,
      reloadMarket,
      quotes,
      history: { stock: sStock?.history ?? [], bond: sBond?.history ?? [], fx: sFx?.history ?? [] },
      freshness,
      lastPriceDate,
      portfolioState,
      valuation,
      today,
      nextRebalance: settings ? nextRebalanceDate(today, settings.schedule) : null,
    };
  }, [settings, holdingRows, ledger, market, marketLoading, reloadMarket, today, stockCode, bondCode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppDataProvider가 필요합니다.');
  return v;
}
