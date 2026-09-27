"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRealtime } from "@/components/realtime/realtime-provider";

const LABELS = {
  live: { text: "Live", hint: "Receiving updates in real time", dot: "bg-emerald-500" },
  connecting: { text: "Connecting", hint: "Connecting to live updates…", dot: "bg-amber-500 animate-pulse" },
  offline: { text: "Offline", hint: "Live updates paused. Retrying shortly.", dot: "bg-muted-foreground" },
} as const;

export function LiveIndicator() {
  const { status } = useRealtime();
  const l = LABELS[status];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
        aria-live="polite"
      >
        <span className={cn("size-2 rounded-full", l.dot)} aria-hidden />
        {l.text}
      </TooltipTrigger>
      <TooltipContent>{l.hint}</TooltipContent>
    </Tooltip>
  );
}
