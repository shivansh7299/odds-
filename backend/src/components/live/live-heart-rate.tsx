"use client";

import { Bluetooth, BluetoothOff, HeartPulse, Loader2, Unplug } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipBox } from "@/components/charts/tooltip";
import { BleDiagnostics } from "@/components/live/ble-diagnostics";
import { useBleHeartRate, type BleStatus } from "@/hooks/use-ble-heart-rate";
import { useNow } from "@/hooks/use-now";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<
  BleStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  unsupported: { label: "Not supported here", variant: "outline" },
  idle: { label: "Not connected", variant: "outline" },
  requesting: { label: "Choose your watch…", variant: "secondary" },
  connecting: { label: "Connecting…", variant: "secondary" },
  connected: { label: "Streaming", variant: "default" },
  reconnecting: { label: "Reconnecting…", variant: "secondary" },
  disconnected: { label: "Disconnected", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

const fmtClock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LiveHeartRate() {
  const ble = useBleHeartRate();
  const busy = ble.status === "requesting" || ble.status === "connecting";
  const values = ble.readings.map((r) => r.bpm);
  const now = useNow(1_000);
  const stale = ble.current != null && now - ble.current.ts > 5_000;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bluetooth className="text-muted-foreground size-4" aria-hidden /> Live heart rate
        </CardTitle>
        <CardDescription>
          {ble.deviceName
            ? `From ${ble.deviceName} over Bluetooth`
            : "Streams straight from your watch to this tab."}
        </CardDescription>
        <CardAction>
          <Badge variant={STATUS[ble.status].variant}>{STATUS[ble.status].label}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-5">
        {ble.status === "unsupported" && (
          <Alert>
            <BluetoothOff aria-hidden />
            <AlertTitle>Bluetooth isn&apos;t available in this browser</AlertTitle>
            <AlertDescription>{ble.unsupportedReason}</AlertDescription>
          </Alert>
        )}
        {ble.error && (
          <Alert variant="destructive">
            <AlertDescription>{ble.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-2" aria-live="polite">
            <HeartPulse
              className={cn(
                "size-6 self-center text-[var(--chart-1)]",
                ble.status === "connected" && !stale && "animate-pulse",
              )}
              aria-hidden
            />
            <span className={cn("text-6xl font-semibold tracking-tight", stale && "text-muted-foreground")}>
              {ble.current ? ble.current.bpm : "—"}
            </span>
            <span className="text-muted-foreground">bpm</span>
          </div>
          {values.length > 1 && (
            <dl className="grid grid-cols-3 gap-6 text-sm">
              {[
                ["Avg", Math.round(values.reduce((a, b) => a + b, 0) / values.length)],
                ["Min", Math.min(...values)],
                ["Max", Math.max(...values)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted-foreground text-xs">{k} · 5 min</dt>
                  <dd className="text-lg font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="h-56">
          {ble.readings.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ble.readings} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMax - 300000", "dataMax"]}
                  stroke="var(--chart-baseline)"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  tickFormatter={(t: number) => fmtClock(t).slice(0, 5)}
                  minTickGap={40}
                />
                <YAxis
                  stroke="var(--chart-baseline)"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  domain={[(min: number) => Math.floor(min - 5), (max: number) => Math.ceil(max + 5)]}
                  allowDecimals={false}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "var(--chart-baseline)" }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as { ts: number; bpm: number } | undefined;
                    if (!active || !p) return null;
                    return (
                      <TooltipBox
                        label={fmtClock(p.ts)}
                        rows={[{ name: "Heart rate", value: `${p.bpm} bpm`, color: "var(--chart-1)" }]}
                      />
                    );
                  }}
                />
                <Line
                  dataKey="bpm"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center rounded-md border border-dashed text-sm">
              {ble.status === "connected"
                ? "Waiting for the first reading…"
                : "Connect your watch to see a live chart."}
            </div>
          )}
        </div>

        {ble.status !== "connected" && (
          <BleDiagnostics lastError={ble.lastError} onScanAll={() => ble.connect("all")} scanning={busy} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {ble.status === "connected" || ble.status === "reconnecting" ? (
              <Button variant="outline" onClick={ble.disconnect}>
                <Unplug aria-hidden /> Disconnect
              </Button>
            ) : (
              <Button onClick={() => ble.connect()} disabled={busy || ble.status === "unsupported"}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Bluetooth aria-hidden />}
                {ble.deviceName ? "Reconnect watch" : "Connect watch"}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {ble.uploadError ??
              (ble.uploaded > 0
                ? `${formatNumber(ble.uploaded)} readings saved${ble.pendingCount ? ` · ${ble.pendingCount} waiting` : ""}`
                : "Readings are saved to your history every 10 seconds.")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BroadcastInstructions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your Forerunner 265</CardTitle>
        <CardDescription>One-time steps, then it&apos;s one tap each session.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid list-decimal gap-2 pl-5 text-sm">
          <li>
            On the watch, open the heart rate glance (from the watch face, press DOWN until you see it).
          </li>
          <li>
            Hold MENU (UP) and choose <strong>Broadcast Heart Rate</strong>. The watch starts advertising.
          </li>
          <li>
            In Chrome or Edge on your Mac, click <strong>Connect watch</strong> and pick the Forerunner in the
            list.
          </li>
          <li>Keep this tab open. The watch can stay paired with your iPhone at the same time.</li>
          <li>Broadcasting uses extra battery. Stop it from the same menu when you&apos;re done.</li>
        </ol>
        <p className="text-muted-foreground mt-3 text-xs">
          Menu names can differ slightly between firmware versions. If you don&apos;t see the option, search
          the Forerunner 265 manual for &quot;Broadcasting Heart Rate Data&quot;.
        </p>
      </CardContent>
    </Card>
  );
}
