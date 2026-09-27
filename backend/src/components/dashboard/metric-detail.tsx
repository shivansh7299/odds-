"use client";

import type { MetricType } from "@/generated/prisma/enums";
import { DailyPanel, SeriesPanel, TrendPanel, type RangeCtx } from "@/components/dashboard/panels";
import type { TrendField } from "@/server/analytics/overview";

const LAYOUT: Record<MetricType, { series: boolean; daily?: "steps" | "calories"; trend?: TrendField }> = {
  HEART_RATE: { series: true, trend: "restingHr" },
  RESTING_HEART_RATE: { series: false, trend: "restingHr" },
  HRV_RMSSD: { series: true, trend: "hrvRmssd" },
  SPO2: { series: true, trend: "spo2Avg" },
  STEPS: { series: true, daily: "steps", trend: "steps" },
  CALORIES: { series: true, daily: "calories", trend: "calories" },
};

export function MetricDetail({ type, ctx }: { type: MetricType; ctx: RangeCtx }) {
  const l = LAYOUT[type];
  return (
    <div className="grid gap-4">
      {l.series && (!l.daily || ctx.days <= 8) && (
        <SeriesPanel type={type} ctx={ctx} height={320} brush title={l.daily ? "Per hour" : "Over time"} />
      )}
      {l.daily && ctx.days > 1 && <DailyPanel field={l.daily} ctx={ctx} height={260} />}
      {l.trend && <TrendPanel field={l.trend} ctx={ctx} height={280} />}
    </div>
  );
}
