import { Bike, Dumbbell, Footprints, PersonStanding } from "lucide-react";
import type { WorkoutRow } from "@/server/metrics/queries";
import { formatDuration, formatNumber } from "@/lib/format";
import { fmtIn } from "@/lib/time-format";

const ACTIVITY: Record<string, { label: string; icon: typeof Bike }> = {
  running: { label: "Run", icon: PersonStanding },
  cycling: { label: "Ride", icon: Bike },
  strength_training: { label: "Strength", icon: Dumbbell },
  walking: { label: "Walk", icon: Footprints },
};

export function WorkoutsTable({ rows, tz }: { rows: WorkoutRow[]; tz: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th scope="col" className="py-2 pr-3 font-medium">
              Activity
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              When
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Duration
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Avg / max HR
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              Distance
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Calories
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((w) => {
            const a = ACTIVITY[w.activityType] ?? {
              label: w.activityType.replace(/_/g, " "),
              icon: PersonStanding,
            };
            return (
              <tr key={w.id} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2 capitalize">
                    <a.icon className="text-muted-foreground size-4" aria-hidden />
                    {a.label}
                  </span>
                </td>
                <td className="text-muted-foreground py-2 pr-3">
                  {fmtIn(w.startAt, tz, "EEE MMM d, HH:mm")}
                </td>
                <td className="py-2 pr-3 text-right">{formatDuration(w.durationSec)}</td>
                <td className="py-2 pr-3 text-right">
                  {w.avgHr ?? "—"} / {w.maxHr ?? "—"}
                </td>
                <td className="py-2 pr-3 text-right">
                  {w.distanceM ? `${(w.distanceM / 1000).toFixed(1)} km` : "—"}
                </td>
                <td className="py-2 text-right">{w.calories != null ? formatNumber(w.calories) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
