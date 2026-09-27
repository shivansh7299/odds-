"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/charts/chart-card";
import { WorkoutsTable } from "@/components/dashboard/workouts-table";
import type { RangeCtx } from "@/components/dashboard/panels";
import { useWorkouts } from "@/hooks/use-dashboard-data";
import { formatDuration, formatNumber } from "@/lib/format";

export function WorkoutsView({ ctx }: { ctx: RangeCtx }) {
  const q = useWorkouts(ctx.qs, 20);
  const rows = q.data?.pages.flatMap((p) => p.workouts) ?? [];
  const totalSec = rows.reduce((a, w) => a + w.durationSec, 0);
  const totalKcal = rows.reduce((a, w) => a + (w.calories ?? 0), 0);

  return (
    <ChartCard
      title="Workouts"
      description={
        rows.length
          ? `${rows.length}${q.hasNextPage ? "+" : ""} workouts · ${formatDuration(totalSec)} · ${formatNumber(totalKcal)} kcal`
          : undefined
      }
      height={240}
      isLoading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={rows.length === 0}
      emptyText="No workouts in this range."
      chart={
        <div className="grid gap-3">
          <WorkoutsTable rows={rows} tz={ctx.tz} />
          {q.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {q.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
              Load more
            </Button>
          )}
        </div>
      }
    />
  );
}
