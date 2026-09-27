"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { RealtimeEvent } from "@/server/realtime/events";

export type RealtimeStatus = "connecting" | "live" | "offline";
type SyncProgress = Extract<RealtimeEvent, { kind: "sync" }>;

const RealtimeContext = createContext<{ status: RealtimeStatus; sync: SyncProgress | null }>({
  status: "connecting",
  sync: null,
});

export const useRealtime = () => useContext(RealtimeContext);

/** Which cached queries each event makes stale. */
function keysFor(event: RealtimeEvent): QueryKey[] {
  switch (event.kind) {
    case "metrics":
      return [["metrics"], ["overview"], ["summary"], ["trends"], ["sources"]];
    case "sleep":
      return [["sleep"], ["overview"], ["summary"], ["trends"]];
    case "workouts":
      return [["workouts"], ["overview"]];
    case "sync":
      return event.status === "RUNNING" ? [["imports"]] : [["sources"], ["imports"]];
    case "source":
      return [["sources"], ["metrics"], ["overview"], ["summary"], ["trends"], ["sleep"], ["workouts"]];
  }
}

/**
 * One EventSource per app shell. Events invalidate TanStack Query caches (batched
 * over 150 ms), so any mounted chart refetches only what changed.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [sync, setSync] = useState<SyncProgress | null>(null);
  const pending = useRef(new Map<string, QueryKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const flush = () => {
      timer.current = null;
      for (const key of pending.current.values()) queryClient.invalidateQueries({ queryKey: key });
      pending.current.clear();
    };

    const onEvent = (msg: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (event.kind === "sync") setSync(event.status === "RUNNING" ? event : null);
      for (const key of keysFor(event)) pending.current.set(JSON.stringify(key), key);
      // Timer, not requestAnimationFrame: rAF never fires in background tabs.
      timer.current ??= setTimeout(flush, 150);
    };

    const connect = () => {
      source = new EventSource("/api/stream");
      source.addEventListener("ready", () => setStatus("live"));
      for (const kind of ["metrics", "sleep", "workouts", "sync", "source"]) {
        source.addEventListener(kind, onEvent as EventListener);
      }
      source.onerror = () => {
        if (disposed || !source) return;
        if (source.readyState === EventSource.CLOSED) {
          // Server refused (e.g. 401) or connection lost for good: back off and retry.
          setStatus("offline");
          source.close();
          retry = setTimeout(connect, 15_000);
        } else {
          setStatus("connecting"); // browser is auto-reconnecting
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      source?.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [queryClient]);

  return <RealtimeContext.Provider value={{ status, sync }}>{children}</RealtimeContext.Provider>;
}
