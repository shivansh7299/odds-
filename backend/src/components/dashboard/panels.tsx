"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartCard, DataTable } from "@/components/charts/chart-card";
import { DailyBars } from "@/components/charts/daily-bars";
import { Hypnogram, STAGES } from "@/components/charts/hypnogram";
import { SeriesChart } from "@/components/charts/series-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { WorkoutsTable } from "@/components/dashboard/workouts-table";
import { useSeries, useSleepNight, useSummary, useTrend, useWorkouts } from "@/hooks/use-dashboard-data";
import type { MetricType } from "@/generated/prisma/enums";
import type { TrendField } from "@/server/analytics/overview";
import type { DaySummary } from "@/server/metrics/queries";
import { formatMinutes, formatNumber } from "@/lib/format";
import { METRICS } from "@/lib/metrics/definitions";
import { shiftDays } from "@/lib/range";
import { fmtDate, fmtIn, labelFormat } from "@/lib/time-format";

/** What every panel needs to know about the selected range (serializable, from the server page). */
export type RangeCtx = {
  qs: string;
  tz: string;
  days: number;
  from: number;
  to: number;
  toDate: string;
  today: string;
};

export function SeriesPanel({
  type,
  ctx,
  title,
  description,
  height,
  brush,
  bucket,
}: {
  type: MetricType;
  ctx: RangeCtx;
  title?: string;
  description?: string;
  height?: number;
  brush?: boolean;
  bucket?: number;
}) {
  const q = useSeries(type, ctx.qs, bucket);
  const meta = METRICS[type];
  const points = q.data?.points ?? [];
  const values = points.map((p) => p.v);
  const summary =
    values.length > 0 && meta.agg === "avg"
      ? `Avg ${formatNumber(values.reduce((a, b) => a + b, 0) / values.length)} · range ${formatNumber(Math.min(...points.map((p) => p.min)))}–${formatNumber(Math.max(...points.map((p) => p.max)))} ${meta.unit}`
      : undefined;
  return (
    <ChartCard
      title={title ?? meta.label}
      href={`/dashboard/${meta.slug}`}
      description={description ?? summary}
      height={height}
      isLoading={q.isLoading}
      isFetching={q.isFetching && !q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={points.length === 0}
      chart={
        q.data && (
          <SeriesChart data={q.data} tz={ctx.tz} height={height} domain={[ctx.from, ctx.to]} brush={brush} />
        )
      }
      table={
        q.data && (
          <DataTable
            columns={["Time", meta.agg === "sum" ? "Total" : "Average", "Min", "Max"]}
            rows={[...points]
              .reverse()
              .map((p) => [
                fmtIn(p.t, ctx.tz, labelFormat(q.data.bucketSec)),
                formatNumber(p.v, meta.agg === "avg" ? 1 : 0),
                formatNumber(p.min),
                formatNumber(p.max),
              ])}
          />
        )
      }
    />
  );
}

const DAILY_FIELDS = {
  steps: { title: "Steps", fmt: (v: number) => formatNumber(v), goal: { value: 10_000, label: "10k goal" } },
  calories: { title: "Active calories", fmt: (v: number) => `${formatNumber(v)}`, goal: undefined },
  sleepMinutes: {
    title: "Sleep duration",
    fmt: (v: number) => formatMinutes(v),
    goal: { value: 480, label: "8 h goal" },
  },
} as const;

/** Per-day bars from daily summaries; for a single day, falls back to hourly buckets. */
export function DailyPanel({
  field,
  ctx,
  height,
}: {
  field: keyof typeof DAILY_FIELDS;
  ctx: RangeCtx;
  height?: number;
}) {
  const cfg = DAILY_FIELDS[field];
  const q = useSummary(ctx.qs);
  if (ctx.days === 1 && field !== "sleepMinutes") {
    return (
      <SeriesPanel
        type={field === "steps" ? "STEPS" : "CALORIES"}
        ctx={ctx}
        bucket={3600}
        height={height}
        description="Per hour, today"
      />
    );
  }
  const rows = (q.data?.days ?? []).map((d: DaySummary) => ({ date: d.date, value: d[field] }));
  const withData = rows.filter((r) => r.value != null);
  const avg = withData.length ? withData.reduce((a, r) => a + r.value!, 0) / withData.length : null;
  return (
    <ChartCard
      title={cfg.title}
      href={
        field === "sleepMinutes"
          ? "/sleep"
          : `/dashboard/${METRICS[field === "steps" ? "STEPS" : "CALORIES"].slug}`
      }
      description={
        avg != null
          ? `Daily average ${cfg.fmt(avg)}` +
            (cfg.goal
              ? ` · ${cfg.goal.label} (line) met ${withData.filter((r) => r.value! >= cfg.goal!.value).length} of ${withData.length} days`
              : "")
          : undefined
      }
      height={height}
      isLoading={q.isLoading}
      isFetching={q.isFetching && !q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={withData.length === 0}
      chart={
        <DailyBars
          rows={rows}
          name={cfg.title}
          format={cfg.fmt}
          goal={cfg.goal}
          height={height}
          yFormat={field === "sleepMinutes" ? (v) => `${Math.round(v / 60)}h` : undefined}
        />
      }
      table={
        <DataTable
          columns={["Date", cfg.title]}
          rows={[...rows]
            .reverse()
            .map((r) => [fmtDate(r.date, "EEE, MMM d"), r.value == null ? "—" : cfg.fmt(r.value)])}
        />
      }
    />
  );
}

const TREND_META: Record<
  TrendField,
  { title: string; unit: string; fmt: (v: number) => string; href: string; maxY?: number }
> = {
  restingHr: {
    title: "Resting heart rate",
    unit: "bpm",
    fmt: (v) => formatNumber(v),
    href: "/dashboard/resting-hr",
  },
  hrvRmssd: {
    title: "HRV (overnight RMSSD)",
    unit: "ms",
    fmt: (v) => formatNumber(v),
    href: "/dashboard/hrv",
  },
  spo2Avg: {
    title: "SpO₂ (overnight avg)",
    unit: "%",
    fmt: (v) => formatNumber(v, 1),
    href: "/dashboard/spo2",
    maxY: 100,
  },
  sleepMinutes: { title: "Sleep duration", unit: "", fmt: (v) => formatMinutes(v), href: "/sleep" },
  steps: { title: "Steps", unit: "", fmt: (v) => formatNumber(v), href: "/dashboard/steps" },
  calories: {
    title: "Active calories",
    unit: "kcal",
    fmt: (v) => formatNumber(v),
    href: "/dashboard/calories",
  },
};

/** Daily trend vs personal baseline. Single-day ranges show the last 14 days for context. */
export function TrendPanel({ field, ctx, height }: { field: TrendField; ctx: RangeCtx; height?: number }) {
  const meta = TREND_META[field];
  const qs = ctx.days < 7 ? `range=custom&from=${shiftDays(ctx.toDate, -13)}&to=${ctx.toDate}` : ctx.qs;
  const q = useTrend(field, qs);
  const points = q.data?.points ?? [];
  const anomalies = points.filter((p) => p.anomaly).length;
  return (
    <ChartCard
      title={meta.title}
      href={meta.href}
      description={
        (ctx.days < 7 ? "Last 14 days. " : "") +
        (anomalies
          ? `${anomalies} unusual day${anomalies > 1 ? "s" : ""} vs your 28-day baseline`
          : "Within your usual range")
      }
      height={height}
      isLoading={q.isLoading}
      isFetching={q.isFetching && !q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={points.every((p) => p.value == null)}
      chart={
        <TrendChart points={points} unit={meta.unit} format={meta.fmt} height={height} maxY={meta.maxY} />
      }
      table={
        <DataTable
          columns={["Date", "Value", "7-day avg", "Usual range", "Flag"]}
          rows={[...points]
            .reverse()
            .map((p) => [
              fmtDate(p.date, "EEE, MMM d"),
              p.value == null ? "—" : meta.fmt(p.value),
              p.rolling7 == null ? "—" : meta.fmt(p.rolling7),
              p.baselineLow == null || p.baselineHigh == null
                ? "—"
                : `${meta.fmt(p.baselineLow)}–${meta.fmt(p.baselineHigh)}`,
              p.anomaly === "high" ? "⚠ Above usual" : p.anomaly === "low" ? "⚠ Below usual" : "",
            ])}
        />
      }
    />
  );
}

/** One night's hypnogram with stage totals; arrows step between nights. */
export function SleepPanel({ ctx, initialDate }: { ctx: RangeCtx; initialDate?: string }) {
  const [date, setDate] = useState(initialDate ?? ctx.toDate);
  const q = useSleepNight(date);
  const night = q.data?.night;
  const nightDate = night ? fmtIn(night.endAt, ctx.tz, "yyyy-MM-dd") : date;

  return (
    <ChartCard
      title="Sleep"
      href="/sleep"
      height={160}
      description={
        night
          ? `${fmtIn(night.startAt, ctx.tz, "EEE HH:mm")} – ${fmtIn(night.endAt, ctx.tz, "HH:mm")} · ${formatMinutes(night.asleepMinutes)} asleep${night.score != null ? ` · score ${night.score}` : ""}`
          : undefined
      }
      isLoading={q.isLoading}
      isFetching={q.isFetching && !q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={!night}
      emptyText="No sleep recorded yet."
      chart={night && <Hypnogram night={night} tz={ctx.tz} />}
      table={
        night && (
          <DataTable
            columns={["Stage", "Minutes", "Share"]}
            rows={STAGES.map((s) => [
              s.label,
              formatMinutes(night.stageMinutes[s.stage]),
              `${Math.round((night.stageMinutes[s.stage] / Math.max(1, night.asleepMinutes + night.stageMinutes.AWAKE)) * 100)}%`,
            ])}
          />
        )
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {night ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Stage totals">
              {STAGES.map((s) => (
                <li key={s.stage} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                  {s.label} {formatMinutes(night.stageMinutes[s.stage])}
                </li>
              ))}
            </ul>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous night"
              onClick={() => setDate(shiftDays(nightDate, -1))}
            >
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">{fmtDate(nightDate, "MMM d")}</span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next night"
              disabled={nightDate >= ctx.today}
              onClick={() => setDate(shiftDays(nightDate, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      }
    />
  );
}

export function WorkoutsPanel({ ctx, limit = 5 }: { ctx: RangeCtx; limit?: number }) {
  const qs = ctx.days < 7 ? `range=7d` : ctx.qs;
  const q = useWorkouts(qs, limit);
  const rows = q.data?.pages.flatMap((p) => p.workouts) ?? [];
  return (
    <ChartCard
      title="Recent workouts"
      href="/workouts"
      description={ctx.days < 7 ? "Last 7 days" : undefined}
      height={200}
      isLoading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={rows.length === 0}
      emptyText="No workouts in this range."
      chart={<WorkoutsTable rows={rows} tz={ctx.tz} />}
    />
  );
}
