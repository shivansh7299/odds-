"use client";

import { DailyPanel, SleepPanel, TrendPanel, type RangeCtx } from "@/components/dashboard/panels";

export function SleepView({ ctx }: { ctx: RangeCtx }) {
  return (
    <div className="grid gap-4">
      <SleepPanel ctx={ctx} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyPanel field="sleepMinutes" ctx={ctx.days < 7 ? { ...ctx, qs: "range=7d", days: 7 } : ctx} />
        <TrendPanel field="hrvRmssd" ctx={ctx} />
      </div>
      <TrendPanel field="spo2Avg" ctx={ctx} />
    </div>
  );
}
