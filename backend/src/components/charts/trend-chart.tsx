"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/server/analytics/trends";
import { compact, fmtDate } from "@/lib/time-format";
import { TooltipBox } from "@/components/charts/tooltip";

const AXIS = {
  stroke: "var(--chart-baseline)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
} as const;

type Props = {
  points: TrendPoint[];
  unit: string;
  format: (v: number) => string;
  height?: number;
  /** Hard ceiling for the y-axis, e.g. 100 for SpO₂. */
  maxY?: number;
};

/** Anomalous days get a ringed marker in the reserved warning color (and a tooltip label). */
function AnomalyDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TrendPoint }) {
  if (cx == null || cy == null) return null;
  if (!payload?.anomaly) return <circle cx={cx} cy={cy} r={2.5} fill="var(--chart-1)" />;
  return <circle cx={cx} cy={cy} r={5} fill="var(--status-warning)" stroke="var(--card)" strokeWidth={2} />;
}

/**
 * Daily values with a 7-day rolling mean and the personal "usual range"
 * (28-day baseline mean ± 1 SD). Days more than 2 SD out are flagged.
 */
export function TrendChart({ points, unit, format, height = 240, maxY }: Props) {
  const rows = points.map((p) => ({
    ...p,
    band: p.baselineLow != null && p.baselineHigh != null ? [p.baselineLow, p.baselineHigh] : null,
  }));
  const dense = rows.length > 45;

  return (
    <div className="grid gap-2">
      <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded bg-[var(--chart-1)]" aria-hidden /> Daily
        </li>
        <li className="flex items-center gap-1.5">
          <span className="bg-muted-foreground h-0.5 w-3 rounded" aria-hidden /> 7-day average
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-[2px] bg-[var(--chart-band)]" aria-hidden /> Usual range
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[var(--status-warning)]" aria-hidden /> Unusual day
        </li>
      </ul>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              {...AXIS}
              tickLine={false}
              tickFormatter={(d) => fmtDate(d)}
              minTickGap={24}
            />
            <YAxis
              {...AXIS}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={["auto", maxY ?? "auto"]}
              allowDecimals={maxY != null}
              allowDataOverflow={false}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? compact(v) : format(v))}
            />
            <Tooltip
              cursor={{ stroke: "var(--chart-baseline)" }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as TrendPoint | undefined;
                if (!active || !p) return null;
                return (
                  <TooltipBox
                    label={fmtDate(p.date, "EEE, MMM d")}
                    rows={[
                      {
                        name: "Value",
                        value: p.value == null ? "No data" : `${format(p.value)} ${unit}`,
                        color: "var(--chart-1)",
                      },
                      ...(p.rolling7 != null
                        ? [{ name: "7-day avg", value: `${format(p.rolling7)} ${unit}` }]
                        : []),
                      ...(p.baselineLow != null && p.baselineHigh != null
                        ? [{ name: "Usual", value: `${format(p.baselineLow)}–${format(p.baselineHigh)}` }]
                        : []),
                      ...(p.anomaly
                        ? [{ name: "⚠ Unusual", value: p.anomaly === "high" ? "Above usual" : "Below usual" }]
                        : []),
                    ]}
                  />
                );
              }}
            />
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--chart-band)"
              isAnimationActive={false}
              connectNulls
            />
            <Line
              dataKey="rolling7"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              dataKey="value"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={
                dense
                  ? false
                  : (props) => (
                      <AnomalyDot
                        key={props.key}
                        cx={props.cx}
                        cy={props.cy}
                        payload={props.payload as TrendPoint}
                      />
                    )
              }
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
            {dense && (
              <Line
                dataKey={(p: TrendPoint) => (p.anomaly ? p.value : null)}
                stroke="none"
                dot={(props) => (
                  <AnomalyDot
                    key={props.key}
                    cx={props.cx}
                    cy={props.cy}
                    payload={props.payload as TrendPoint}
                  />
                )}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
