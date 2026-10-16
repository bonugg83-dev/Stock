import type { AppData } from '../app/AppData';
import type { RebalanceRecord, UserSettings } from '../db/schema';
import type { Plan } from '../engine/allocate';
import { ALL_ASSETS } from '../engine/types';

/** 계산 결과를 재현 가능한 기록으로 변환 (기준 가격·시각 포함) */
export function planToRecord(plan: Plan, kind: RebalanceRecord['kind'], app: AppData, s: UserSettings, confirmed: boolean): Omit<RebalanceRecord, 'id'> {
  return {
    kind,
    calculatedAt: new Date().toISOString(),
    priceDate: app.lastPriceDate,
    prices: { stock: plan.lines.stock.price!.toNumber(), bond: plan.lines.bond.price!.toNumber() },
    mode: plan.mode,
    additionalCash: plan.additionalCash.toNumber(),
    totalBefore: plan.totalBefore.toNumber(),
    totalAfter: plan.totalAfter.toNumber(),
    targets: { ...s.targets },
    lines: ALL_ASSETS.map((a) => {
      const l = plan.lines[a];
      return {
        asset: a,
        action: l.action,
        quantity: l.quantity,
        price: l.price?.toNumber() ?? null,
        weightBefore: l.weightBefore?.toNumber() ?? null,
        weightAfter: l.weightAfter?.toNumber() ?? null,
        targetWeight: l.targetWeight.toNumber(),
      };
    }),
    notes: plan.notes,
    confirmed,
    executed: false,
  };
}
