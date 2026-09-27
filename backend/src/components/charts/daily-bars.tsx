"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, fmtDate } from "@/lib/time-format";
import { TooltipBox } from "@/components/charts/tooltip";

const AXIS = {
  stroke: "var(--chart-baseline)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
} as const;

type Props = {
  rows: { date: string; value: number | null }[];
  name: string;
  format: (v: number) => string;
  goal?: { value: number; label: string };
  height?: number;
  yFormat?: (v: number) => string;
};

/** One bar per local day (steps, calories, sleep duration). */
export function DailyBars({ rows, name, format, goal, height = 240, yFormat }: Props) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 8, left: -8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            {...AXIS}
            tickLine={false}
            tickFormatter={(d) => fmtDate(d)}
            minTickGap={16}
          />
          <YAxis {...AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={yFormat ?? compact} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Props["rows"][number] | undefined;
              if (!active || !p) return null;
              return (
                <TooltipBox
                  label={fmtDate(p.date, "EEE, MMM d")}
                  rows={[
                    { name, value: p.value == null ? "No data" : format(p.value), color: "var(--chart-1)" },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="value"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            maxBarSize={40}
          />
          {goal && (
            <ReferenceLine
              y={goal.value}
              stroke="var(--foreground)"
              strokeOpacity={0.45}
              ifOverflow="extendDomain"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
