"use client";

import { KpiTiles } from "@/components/dashboard/kpi-tiles";
import {
  DailyPanel,
  SeriesPanel,
  SleepPanel,
  TrendPanel,
  WorkoutsPanel,
  type RangeCtx,
} from "@/components/dashboard/panels";
import { useOverview } from "@/hooks/use-dashboard-data";

export function DashboardView({ ctx }: { ctx: RangeCtx }) {
  const overview = useOverview(ctx.qs);
  return (
    <div className="grid gap-4">
      <KpiTiles data={overview.data} isLoading={overview.isLoading} />
      <SeriesPanel type="HEART_RATE" ctx={ctx} height={260} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyPanel field="steps" ctx={ctx} />
        <DailyPanel field="calories" ctx={ctx} />
        <TrendPanel field="restingHr" ctx={ctx} />
        <TrendPanel field="hrvRmssd" ctx={ctx} />
        <SleepPanel ctx={ctx} />
        <TrendPanel field="spo2Avg" ctx={ctx} />
      </div>
      <WorkoutsPanel ctx={ctx} />
    </div>
  );
}
