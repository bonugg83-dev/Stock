import { formatPct, type Dec } from './money';
import { daysBetween } from './schedule';
import { ASSET_LABEL, ALL_ASSETS, type AssetKey } from './types';
import type { Freshness } from './freshness';

/**
 * 앱 내부 알림 생성 (순수 함수).
 * 앱을 열 때 현재 상태로 알림 목록을 만들고, key로 중복을 막는다.
 * 나중에 OS 푸시 알림을 붙일 때도 이 함수의 결과를 그대로 전달하면 된다.
 *
 * 문구 원칙: 매매 지시가 아니라 "계산 결과 안내"로 작성한다.
 */

export type NoticeLevel = 'info' | 'warning';

export interface Notice {
  key: string;
  level: NoticeLevel;
  title: string;
  body: string;
}

export interface NoticeContext {
  today: string;
  nextRebalance: string;
  remindDaysBefore: number;
  freshness: Freshness;
  lastPriceDate: string | null;
  dataError: string | null;
  actualWeights: Record<AssetKey, Dec | null> | null;
  targetWeights: Record<AssetKey, number>;
  tolerancePctPoint: number;
  pendingDistributions: number;
}

export function buildNotices(c: NoticeContext): Notice[] {
  const out: Notice[] = [];
  const left = daysBetween(c.today, c.nextRebalance);
  const weightText = (a: AssetKey) =>
    c.actualWeights?.[a] != null ? `${ASSET_LABEL[a]} 비중은 ${formatPct(c.actualWeights[a])}, 목표 비중은 ${c.targetWeights[a]}%` : '';

  if (left === 0) {
    out.push({
      key: `rebalance-day:${c.nextRebalance}`,
      level: 'info',
      title: '분기 리밸런싱 예정일입니다',
      body: `분기 리밸런싱 예정일입니다. ${c.actualWeights ? `현재 포트폴리오의 ${weightText('stock')}입니다. ` : ''}최신 가격과 거래 비용을 확인한 뒤 조정안을 검토하세요.`,
    });
  } else if (left > 0 && left <= c.remindDaysBefore) {
    out.push({
      key: `rebalance-soon:${c.nextRebalance}`,
      level: 'info',
      title: `리밸런싱 ${left}일 전`,
      body: `다음 리밸런싱 예정일(${c.nextRebalance})까지 ${left}일 남았습니다. 리밸런싱 화면에서 계산상 조정안을 미리 확인할 수 있습니다.`,
    });
  }

  if (c.dataError) {
    out.push({
      key: `data-error:${c.today}`,
      level: 'warning',
      title: '가격 데이터 업데이트 실패',
      body: `${c.dataError}. ${c.lastPriceDate ? `마지막으로 성공한 ${c.lastPriceDate} 데이터를 표시합니다.` : '표시할 데이터가 없습니다.'}`,
    });
  }
  if (c.freshness === 'stale') {
    out.push({
      key: `data-stale:${c.lastPriceDate}`,
      level: 'warning',
      title: '가격 데이터가 오래되었습니다',
      body: `마지막 가격 기준일이 ${c.lastPriceDate}입니다. 최신 데이터가 아닐 수 있으니 실제 거래 전에 증권사 앱에서 현재가를 확인하세요.`,
    });
  }

  if (c.actualWeights) {
    const out_ = ALL_ASSETS.filter((a) => {
      const w = c.actualWeights![a];
      return w !== null && w.sub(c.targetWeights[a]).abs().gt(c.tolerancePctPoint);
    });
    if (out_.length) {
      out.push({
        key: `tolerance:${c.today}:${out_.join(',')}`,
        level: 'warning',
        title: '비중이 허용 범위를 벗어났습니다',
        body: `${out_.map(weightText).join(', ')}입니다 (허용 오차 ±${c.tolerancePctPoint}%p). 리밸런싱 화면에서 계산상 조정안을 검토할 수 있습니다.`,
      });
    }
  }

  if (c.pendingDistributions > 0) {
    out.push({
      key: `distribution:${c.today}:${c.pendingDistributions}`,
      level: 'info',
      title: '확인할 분배금이 있습니다',
      body: `보유 수량 기준으로 추정한 분배금 ${c.pendingDistributions}건이 있습니다. 실제 입금액을 확인한 뒤 현금에 반영하세요.`,
    });
  }
  return out;
}
