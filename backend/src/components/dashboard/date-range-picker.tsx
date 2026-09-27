"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, rangeSearchParams, type RangeKey } from "@/lib/range";
import { fmtDate } from "@/lib/time-format";

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (s: string) => new Date(`${s}T12:00:00`);

/** Range presets + custom range. The range lives in the URL so views are shareable. */
export function DateRangePicker({
  range,
  today,
}: {
  range: { key: RangeKey; fromDate: string; toDate: string };
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>({
    from: fromYmd(range.fromDate),
    to: fromYmd(range.toDate),
  });

  const go = (qs: string) => startTransition(() => router.replace(`${pathname}?${qs}`, { scroll: false }));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div role="group" aria-label="Date range" className="flex rounded-lg border p-0.5">
        {RANGE_PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={range.key === p.key ? "secondary" : "ghost"}
            aria-pressed={range.key === p.key}
            onClick={() => go(`range=${p.key}`)}
            className="px-2.5"
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button size="sm" variant={range.key === "custom" ? "secondary" : "outline"} />}
        >
          <CalendarRange aria-hidden />
          {range.key === "custom" ? `${fmtDate(range.fromDate)} – ${fmtDate(range.toDate)}` : "Custom"}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={draft}
            onSelect={setDraft}
            numberOfMonths={1}
            defaultMonth={draft?.to}
            disabled={{ after: fromYmd(today) }}
          />
          <div className="flex justify-end gap-2 border-t p-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return;
                const from = toYmd(draft.from);
                const to = toYmd(draft.to ?? draft.from);
                setOpen(false);
                go(rangeSearchParams({ key: "custom", fromDate: from, toDate: to }));
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
