import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { DateRange } from "@/lib/range";
import { fmtDate } from "@/lib/time-format";

export function rangeLabel(r: Pick<DateRange, "days" | "fromDate" | "toDate" | "key">) {
  if (r.key === "today") return `Today, ${fmtDate(r.toDate, "EEEE MMM d")}`;
  return `${fmtDate(r.fromDate, "MMM d")} – ${fmtDate(r.toDate, "MMM d, yyyy")} · ${r.days} days`;
}

export function DashboardHeader({
  title,
  range,
  today,
  simulated,
}: {
  title: string;
  range: DateRange;
  today: string;
  simulated: boolean;
}) {
  return (
    <PageHeader
      title={title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          {rangeLabel(range)}
          {simulated && (
            <Badge variant="outline" className="gap-1 font-normal">
              <FlaskConical className="size-3" aria-hidden /> Includes simulated data
            </Badge>
          )}
        </span>
      }
      actions={<DateRangePicker range={range} today={today} />}
    />
  );
}
