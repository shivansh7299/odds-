"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SleepStage } from "@/generated/prisma/enums";
import type { SleepNight } from "@/server/metrics/queries";
import { formatMinutes } from "@/lib/format";
import { fmtIn } from "@/lib/time-format";
import { TooltipBox } from "@/components/charts/tooltip";

export const STAGES: { stage: SleepStage; label: string; color: string }[] = [
  { stage: "AWAKE", label: "Awake", color: "var(--stage-awake)" },
  { stage: "REM", label: "REM", color: "var(--stage-rem)" },
  { stage: "LIGHT", label: "Light", color: "var(--stage-light)" },
  { stage: "DEEP", label: "Deep", color: "var(--stage-deep)" },
];

const ROW = 26;
const GAP = 6;
const LABEL_W = 48;
const AXIS_H = 22;

/** Sleep stages over the night: one lane per stage (position encodes stage, color reinforces it). */
export function Hypnogram({ night, tz }: { night: SleepNight; tz: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const start = new Date(night.startAt).getTime();
  const end = new Date(night.endAt).getTime();
  const plotW = Math.max(100, width - LABEL_W - 8);
  const x = (t: number) => LABEL_W + ((t - start) / (end - start)) * plotW;
  const height = STAGES.length * (ROW + GAP) + AXIS_H;

  const ticks: number[] = [];
  const firstHour = Math.ceil(start / 3_600_000) * 3_600_000;
  const step = plotW < 360 ? 2 : 1;
  for (let t = firstHour; t < end; t += step * 3_600_000) ticks.push(t);

  const seg = hover ? night.stages[hover.i] : null;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label="Sleep stages across the night">
        {STAGES.map((s, row) => (
          <g key={s.stage}>
            <text
              x={0}
              y={row * (ROW + GAP) + ROW / 2}
              dominantBaseline="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {s.label}
            </text>
            <rect
              x={LABEL_W}
              y={row * (ROW + GAP)}
              width={plotW}
              height={ROW}
              rx={4}
              className="fill-muted/40"
            />
          </g>
        ))}
        {night.stages.map((st, i) => {
          const row = STAGES.findIndex((s) => s.stage === st.stage);
          const t0 = new Date(st.startAt).getTime();
          const x0 = x(t0);
          const w = Math.max(1, x(t0 + st.seconds * 1000) - x0 - 1);
          return (
            <rect
              key={i}
              x={x0}
              y={row * (ROW + GAP)}
              width={w}
              height={ROW}
              rx={2}
              fill={STAGES[row]!.color}
              opacity={hover && hover.i !== i ? 0.55 : 1}
              onMouseMove={(e) => {
                const box = ref.current!.getBoundingClientRect();
                setHover({ i, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
            />
          );
        })}
        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {fmtIn(t, tz, "HH:mm")}
          </text>
        ))}
      </svg>
      {seg && hover && (
        <div
          className="pointer-events-none absolute z-10"
          style={{ left: Math.min(hover.x + 12, width - 170), top: hover.y + 12 }}
        >
          <TooltipBox
            label={STAGES.find((s) => s.stage === seg.stage)!.label}
            rows={[
              {
                name: fmtIn(seg.startAt, tz, "HH:mm"),
                value: formatMinutes(Math.round(seg.seconds / 60)),
                color: STAGES.find((s) => s.stage === seg.stage)!.color,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
