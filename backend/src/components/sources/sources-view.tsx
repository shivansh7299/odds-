"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bluetooth, FileUp, FlaskConical, Loader2, Pause, Play, Trash2, Watch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { ConnectIqDevices } from "@/components/sources/connectiq-devices";
import { useNow } from "@/hooks/use-now";
import { apiFetch } from "@/lib/api/fetcher";
import { formatAgo, formatNumber } from "@/lib/format";
import { METRICS } from "@/lib/metrics/definitions";
import type { SourceListItem } from "@/server/sources/queries";

const SLUGS = {
  MOCK: "mock",
  GARMIN_BLE: "ble",
  GARMIN_CONNECTIQ: "connectiq",
  GARMIN_FIT: "fit",
  GARMIN_HEALTH_API: "garmin-health",
} as const;

const ICONS = {
  MOCK: FlaskConical,
  GARMIN_BLE: Bluetooth,
  GARMIN_CONNECTIQ: Watch,
  GARMIN_FIT: FileUp,
} as const;

type SourcesResponse = { sources: SourceListItem[] };

export function SourcesView({ initial }: { initial: SourceListItem[] }) {
  const { data } = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiFetch<SourcesResponse>("/api/sources"),
    initialData: { sources: initial },
    staleTime: 0,
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {data.sources.map((s) => (
        <SourceCard key={s.type} source={s} />
      ))}
    </div>
  );
}

const STATUS_BADGE = {
  ACTIVE: { label: "Active", variant: "default" },
  PAUSED: { label: "Paused", variant: "secondary" },
  NEEDS_REAUTH: { label: "Reconnect needed", variant: "destructive" },
  REVOKED: { label: "Revoked", variant: "destructive" },
  ERROR: { label: "Error", variant: "destructive" },
} as const;

function SourceCard({ source }: { source: SourceListItem }) {
  const Icon = ICONS[source.type as keyof typeof ICONS] ?? Watch;
  const conn = source.connection;
  const now = useNow();
  const { sync } = useRealtime();
  const queryClient = useQueryClient();
  const syncing = sync?.source === source.type ? sync : null;

  const mutate = useMutation({
    mutationFn: (action: "connect" | "pause" | "resume" | "remove") => {
      const url = `/api/sources/${SLUGS[source.type]}`;
      if (action === "connect") return apiFetch(url, { method: "POST" });
      if (action === "remove") return apiFetch(url, { method: "DELETE" });
      return apiFetch(url, {
        method: "PATCH",
        body: JSON.stringify({ status: action === "pause" ? "PAUSED" : "ACTIVE" }),
      });
    },
    onSuccess: (_d, action) => {
      queryClient.invalidateQueries();
      if (action === "connect") toast.success("Simulated source connected. Generating 30 days of history…");
      if (action === "remove") toast.success(`${source.label} removed and its data deleted.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const comingSoon = !source.available && source.milestone;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4" aria-hidden />
          <CardTitle>{source.label}</CardTitle>
        </div>
        <CardDescription>{source.description}</CardDescription>
        <CardAction>
          {conn ? (
            <Badge variant={STATUS_BADGE[conn.status].variant}>{STATUS_BADGE[conn.status].label}</Badge>
          ) : comingSoon ? (
            <Badge variant="outline">Milestone {source.milestone}</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {source.metrics.map((m) => (
            <Badge key={m} variant="secondary" className="font-normal">
              {METRICS[m].label}
            </Badge>
          ))}
        </div>

        {conn && (
          <dl className="text-muted-foreground grid grid-cols-2 gap-y-1 sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt>Latest data</dt>
            <dd className="text-foreground">{formatAgo(conn.lastDataAt, now)}</dd>
            <dt>Last sync</dt>
            <dd className="text-foreground">{formatAgo(conn.lastSyncedAt, now)}</dd>
          </dl>
        )}

        {syncing && (
          <div className="grid gap-1.5" role="status">
            <div className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {syncing.message ?? "Syncing…"}
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-[width]"
                style={{ width: `${Math.round((syncing.progress ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {conn?.lastError && <p className="text-destructive">Last error: {conn.lastError}</p>}

        {source.type === "GARMIN_CONNECTIQ" && <ConnectIqDevices />}

        {conn && conn.syncRuns.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer select-none">Recent sync runs</summary>
            <ul className="mt-2 grid gap-1">
              {conn.syncRuns.map((r) => (
                <li key={r.id} className="flex justify-between gap-4">
                  <span>
                    {r.trigger.toLowerCase()} · {formatAgo(r.startedAt, now)}
                  </span>
                  <span className={r.status === "FAILED" ? "text-destructive" : undefined}>
                    {r.status === "SUCCEEDED"
                      ? `${formatNumber(r.recordsUpserted)} records`
                      : r.status.toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      {((source.type === "MOCK" && source.available) || conn) && (
        <CardFooter className="flex flex-wrap gap-2">
          {!conn && source.type === "MOCK" && (
            <Button onClick={() => mutate.mutate("connect")} disabled={mutate.isPending}>
              {mutate.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Enable simulated data
            </Button>
          )}
          {conn?.status === "ACTIVE" && (
            <Button variant="outline" onClick={() => mutate.mutate("pause")} disabled={mutate.isPending}>
              <Pause aria-hidden /> Pause
            </Button>
          )}
          {conn?.status === "PAUSED" && (
            <Button variant="outline" onClick={() => mutate.mutate("resume")} disabled={mutate.isPending}>
              <Play aria-hidden /> Resume
            </Button>
          )}
          {conn && (
            <Button
              variant="destructive"
              disabled={mutate.isPending}
              onClick={() => {
                if (confirm("Remove the simulated source and delete all of its data?"))
                  mutate.mutate("remove");
              }}
            >
              <Trash2 aria-hidden /> Remove & delete data
            </Button>
          )}
        </CardFooter>
      )}
      {source.type === "GARMIN_BLE" && (
        <CardFooter>
          <Link href="/live" className={buttonVariants({ variant: conn ? "outline" : "default" })}>
            <Bluetooth aria-hidden /> {conn ? "Open Live page" : "Connect on the Live page"}
          </Link>
        </CardFooter>
      )}
      {source.type === "GARMIN_FIT" && (
        <CardFooter>
          <Link href="/sources/import" className={buttonVariants({ variant: conn ? "outline" : "default" })}>
            <FileUp aria-hidden /> Import files
          </Link>
        </CardFooter>
      )}
      {source.type === "MOCK" && !source.available && (
        <CardFooter className="text-muted-foreground text-sm">
          Disabled on this server (ENABLE_MOCK_SOURCE=false).
        </CardFooter>
      )}
    </Card>
  );
}
