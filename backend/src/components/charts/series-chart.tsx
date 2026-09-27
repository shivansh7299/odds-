"use client";

import {
  Area,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesResponse } from "@/hooks/use-dashboard-data";
import { formatNumber } from "@/lib/format";
import { METRICS } from "@/lib/metrics/definitions";
import { compact, fmtIn, labelFormat, tickFormat, timeTicks } from "@/lib/time-format";
import { TooltipBox } from "@/components/charts/tooltip";

const AXIS = {
  stroke: "var(--chart-baseline)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
} as const;

type Props = {
  data: SeriesResponse;
  tz: string;
  height?: number;
  /** Explicit x-domain so gaps (no data) read as gaps. */
  domain: [number, number];
  brush?: boolean;
};

/**
 * Bucketed metric over time. Rate metrics (HR, HRV, SpO₂) draw an average line
 * with a min–max band; count metrics (steps, calories) draw bars.
 */
export function SeriesChart({ data, tz, height = 240, domain, brush }: Props) {
  const meta = METRICS[data.type];
  const rows = data.points.map((p) => ({ ...p, ts: new Date(p.t).getTime(), range: [p.min, p.max] }));
  const tick = (v: number) => fmtIn(v, tz, tickFormat(data.bucketSec));
  const axis = timeTicks(domain[0], domain[1], tz);
  const showBand = data.bucketSec > 60 && meta.agg === "avg";

  const tooltip = (
    <Tooltip
      cursor={meta.agg === "sum" ? { fill: "var(--muted)" } : { stroke: "var(--chart-baseline)" }}
      isAnimationActive={false}
      content={({ active, payload }) => {
        const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
        if (!active || !p) return null;
        return (
          <TooltipBox
            label={fmtIn(p.ts, tz, labelFormat(data.bucketSec))}
            rows={[
              {
                name: meta.agg === "sum" ? "Total" : "Average",
                value: `${formatNumber(p.v, meta.agg === "avg" && p.v < 100 ? 1 : 0)} ${meta.unit}`,
                color: "var(--chart-1)",
              },
              ...(showBand
                ? [{ name: "Range", value: `${formatNumber(p.min)}–${formatNumber(p.max)} ${meta.unit}` }]
                : []),
            ]}
          />
        );
      }}
    />
  );

  if (meta.agg === "sum") {
    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="ts"
              {...AXIS}
              tickLine={false}
              tickFormatter={(v: number) => fmtIn(v, tz, axis.pattern === "HH:mm" ? "HH:mm" : "EEE d")}
              minTickGap={24}
            />
            <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} tickFormatter={compact} />
            {tooltip}
            <Bar dataKey="v" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={domain}
            {...AXIS}
            tickLine={false}
            ticks={axis.ticks}
            tickFormatter={(v: number) => fmtIn(v, tz, axis.pattern)}
            minTickGap={24}
          />
          <YAxis
            {...AXIS}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[(min: number) => Math.floor(min - 3), (max: number) => Math.ceil(max + 3)]}
            allowDecimals={false}
          />
          {tooltip}
          {showBand && (
            <Area
              dataKey="range"
              stroke="none"
              fill="var(--chart-band)"
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
          <Line
            dataKey="v"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {brush && rows.length > 30 && (
            <Brush
              dataKey="ts"
              height={24}
              stroke="var(--chart-baseline)"
              tickFormatter={tick}
              travellerWidth={8}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
