"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import type { Overview } from "@/server/analytics/overview";
import { formatAgo, formatMinutes, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tile = {
  key: string;
  label: string;
  href?: string;
  value: string;
  unit?: string;
  change?: number | null;
  /** Whether an increase is good (steps) or bad (resting HR). Undefined = neutral. */
  higherIsBetter?: boolean;
  footnote?: string;
};

function Delta({
  change,
  higherIsBetter,
  comparedTo,
}: {
  change: number;
  higherIsBetter?: boolean;
  comparedTo: string;
}) {
  const flat = Math.abs(change) < 0.01;
  const up = change > 0;
  const good = higherIsBetter === undefined || flat ? null : up === higherIsBetter;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs",
        good === true && "text-[var(--status-good)]",
        good === false && "text-[var(--status-critical)]",
        good === null && "text-muted-foreground",
      )}
      title={`vs ${comparedTo}`}
    >
      <Icon className="size-3.5" aria-hidden />
      {flat ? "No change" : `${up ? "+" : ""}${Math.round(change * 100)}%`}
      <span className="sr-only"> vs {comparedTo}</span>
    </span>
  );
}

export function KpiTiles({ data, isLoading }: { data?: Overview; isLoading: boolean }) {
  const now = useNow();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
    );
  }

  const per = data.perDay ? "/day" : "";
  const tiles: Tile[] = [
    {
      key: "hr",
      label: "Heart rate",
      href: "/dashboard/heart-rate",
      value: data.heartRate ? formatNumber(data.heartRate.value) : "—",
      unit: "bpm",
      footnote: data.heartRate ? formatAgo(data.heartRate.ts, now) : "Latest reading",
    },
    {
      key: "rhr",
      label: "Resting HR",
      href: "/dashboard/resting-hr",
      value: formatNumber(data.restingHr.value),
      unit: "bpm",
      change: data.restingHr.change,
      higherIsBetter: false,
    },
    {
      key: "hrv",
      label: "HRV",
      href: "/dashboard/hrv",
      value: formatNumber(data.hrvRmssd.value),
      unit: "ms",
      change: data.hrvRmssd.change,
      higherIsBetter: true,
    },
    {
      key: "sleep",
      label: data.perDay ? "Sleep" : "Last night",
      href: "/sleep",
      value: formatMinutes(data.sleepMinutes.value),
      change: data.sleepMinutes.change,
      higherIsBetter: true,
    },
    {
      key: "steps",
      label: "Steps",
      href: "/dashboard/steps",
      value: formatNumber(data.steps.value),
      unit: per,
      change: data.steps.change,
      higherIsBetter: true,
      footnote: data.steps.partial ? "So far today" : undefined,
    },
    {
      key: "cal",
      label: "Active calories",
      href: "/dashboard/calories",
      value: formatNumber(data.calories.value),
      unit: `kcal${per}`,
      change: data.calories.change,
      higherIsBetter: true,
      footnote: data.calories.partial ? "So far today" : undefined,
    },
    {
      key: "spo2",
      label: "SpO₂ (overnight)",
      href: "/dashboard/spo2",
      value: formatNumber(data.spo2Avg.value, 1),
      unit: "%",
      change: data.spo2Avg.change,
    },
    {
      key: "active",
      label: "Active minutes",
      value: formatNumber(data.activeMinutes.value),
      unit: `min${per}`,
      change: data.activeMinutes.change,
      higherIsBetter: true,
      footnote: data.activeMinutes.partial ? "So far today" : undefined,
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Key metrics">
      {tiles.map((t) => {
        const content = (
          <Card className="group-hover:bg-muted/40 h-full gap-1 px-4 py-3.5 transition-colors">
            <div className="text-muted-foreground text-xs">{t.label}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tracking-tight">{t.value}</span>
              {t.unit && t.value !== "—" && <span className="text-muted-foreground text-xs">{t.unit}</span>}
            </div>
            <div className="min-h-4">
              {t.change != null ? (
                <Delta change={t.change} higherIsBetter={t.higherIsBetter} comparedTo={data.comparedTo} />
              ) : (
                t.footnote && <span className="text-muted-foreground text-xs">{t.footnote}</span>
              )}
            </div>
          </Card>
        );
        return (
          <li key={t.key}>
            {t.href ? (
              <Link
                href={t.href}
                className="group focus-visible:ring-ring/50 block h-full rounded-xl focus-visible:ring-3 focus-visible:outline-none"
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
