"use client";

/** Tooltip body shared by all charts: a label line, then one row per value. */
export function TooltipBox({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color?: string; note?: string }[];
}) {
  return (
    <div className="bg-popover text-popover-foreground grid min-w-36 gap-1.5 rounded-lg border px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          {r.color && (
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.color }} aria-hidden />
          )}
          <span className="text-muted-foreground">{r.name}</span>
          <span className="ml-auto font-medium tabular-nums">{r.value}</span>
          {r.note && <span className="text-muted-foreground">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}
