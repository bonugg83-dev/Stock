import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppData } from './app/AppData';
import { db } from './db/db';
import { buildNotices } from './engine/notifications';
import { requestPersistentStorage } from './db/backupFile';
import { cx, formatDateTime } from './ui/components/ui';
import Onboarding, { OnboardingSummary } from './ui/pages/Onboarding';
import Dashboard from './ui/pages/Dashboard';
import Rebalance from './ui/pages/Rebalance';
// 차트 라이브러리가 커서 분석 화면은 필요할 때 불러온다
const Analysis = lazy(() => import('./ui/pages/Analysis'));
import History from './ui/pages/History';
import Settings from './ui/pages/Settings';

const NAV = [
  { to: '/', label: '대시보드' },
  { to: '/rebalance', label: '리밸런싱' },
  { to: '/analysis', label: '분석' },
  { to: '/history', label: '기록' },
  { to: '/settings', label: '설정' },
];

/** 앱을 열 때 현재 상태로 앱 내부 알림을 만든다 (중복은 key로 방지) */
function useNotificationSync() {
  const app = useAppData();
  useEffect(() => {
    const s = app.settings;
    if (!s || !app.nextRebalance || app.marketLoading || !app.market) return;
    const nowKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16);
    const notices = buildNotices({
      today: app.today,
      nextRebalance: app.nextRebalance,
      remindDaysBefore: s.remindDaysBefore,
      freshness: app.market.file?.isMock ? 'fresh' : app.freshness,
      lastPriceDate: app.lastPriceDate,
      dataError: app.market.error,
      actualWeights: app.valuation?.weights ?? null,
      targetWeights: s.targets,
      tolerancePctPoint: s.tolerancePctPoint,
      pendingDistributions: 0,
    }).filter((n) => !n.key.startsWith('rebalance') || nowKst >= s.notifyTime);
    (async () => {
      for (const n of notices) {
        const exists = await db.notifications.get(n.key);
        if (!exists) await db.notifications.put({ ...n, createdAt: new Date().toISOString(), read: false });
      }
    })();
  }, [app]);
}

function Bell() {
  const [open, setOpen] = useState(false);
  const list = useLiveQuery(() => db.notifications.orderBy('createdAt').reverse().limit(30).toArray(), []) ?? [];
  const unread = list.filter((n) => !n.read).length;
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="relative">
      <button
        aria-label={`알림 ${unread}개`}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) db.notifications.filter((n) => !n.read).modify({ read: true });
        }}
        className="relative rounded-lg p-2 hover:bg-white/10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          {list.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">알림이 없습니다.</p>
          ) : (
            list.map((n) => (
              <div key={n.key} className="border-b border-slate-100 p-2 last:border-0 dark:border-slate-800">
                <p className={cx('text-sm font-semibold', n.level === 'warning' && 'text-amber-700 dark:text-amber-400')}>{n.title}</p>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{n.body}</p>
                <p className="mt-1 text-[10px] text-slate-400">{formatDateTime(n.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const app = useAppData();
  useNotificationSync();
  const hasSettings = !!app.settings;
  // 설정이 저장된 뒤에는 브라우저가 저장 공간을 임의로 지우지 않도록 요청
  useEffect(() => {
    if (hasSettings) requestPersistentStorage();
  }, [hasSettings]);

  if (!app.ready) return <div className="p-8 text-center text-sm text-slate-500">불러오는 중…</div>;
  if (!app.settings) {
    return (
      <Routes>
        <Route path="*" element={<Onboarding />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 bg-[#1e3a5f] text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
          <span className="font-bold">기계적 리밸런싱</span>
          <nav className="hidden gap-1 sm:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => cx('rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Bell />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/rebalance" element={<Rebalance />} />
          <Route path="/analysis" element={<Suspense fallback={<p className="text-sm text-slate-500">불러오는 중…</p>}><Analysis /></Suspense>} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/welcome" element={<OnboardingSummary />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end className={({ isActive }) => cx('py-3 text-center text-xs', isActive ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500')}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
