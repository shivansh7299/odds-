"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleHelp, Radar, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type Check = { label: string; ok: boolean | null; detail: string };

async function runChecks(): Promise<Check[]> {
  const secure = window.isSecureContext;
  const hasApi = "bluetooth" in navigator;
  const brands =
    (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands
      .map((b) => b.brand)
      .filter((b) => !/Not.?A.?Brand/i.test(b))
      .join(", ") ?? navigator.userAgent;
  const chromium = /Chrome|Chromium|Edge|Edg\//i.test(brands);

  let available: boolean | null = null;
  if (hasApi && navigator.bluetooth.getAvailability) {
    try {
      available = await navigator.bluetooth.getAvailability();
    } catch {
      available = null;
    }
  }

  return [
    {
      label: "Page is a secure context",
      ok: secure,
      detail: secure
        ? `${location.origin} is allowed to use Bluetooth.`
        : `${location.origin} is not secure. Open http://localhost:3000 (not the 192.168… network address) or use an https:// URL.`,
    },
    {
      label: "Browser supports Web Bluetooth",
      ok: hasApi,
      detail: hasApi
        ? `Detected: ${brands}.`
        : `Detected: ${brands}. Use Google Chrome or Microsoft Edge on the Mac (Safari, Firefox and all iPhone browsers don't support it).`,
    },
    {
      label: "Browser can use the Bluetooth adapter",
      ok: available,
      detail:
        available === true
          ? "Bluetooth is on and the browser is allowed to use it."
          : available === false
            ? "The browser reports no usable Bluetooth. Turn Bluetooth on, then check macOS System Settings → Privacy & Security → Bluetooth → enable Google Chrome, and restart Chrome."
            : chromium
              ? "Couldn't determine. Continue with the checklist below."
              : "Not available in this browser.",
    },
  ];
}

export function BleDiagnostics({
  lastError,
  onScanAll,
  scanning,
}: {
  lastError: string | null;
  onScanAll: () => void;
  scanning: boolean;
}) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const refresh = useCallback(() => {
    void runChecks().then(setChecks);
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <details className="group rounded-lg border px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium select-none">
        Can&apos;t find your watch? Run diagnostics
      </summary>
      <div className="mt-3 grid gap-4">
        <ul className="grid gap-2">
          {(checks ?? []).map((c) => (
            <li key={c.label} className="flex gap-2">
              {c.ok === true ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-[var(--status-good)]"
                  aria-label="Pass"
                />
              ) : c.ok === false ? (
                <XCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Fail" />
              ) : (
                <CircleHelp className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-label="Unknown" />
              )}
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-muted-foreground">{c.detail}</div>
              </div>
            </li>
          ))}
          {lastError && (
            <li className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all">
              Last browser error: {lastError}
            </li>
          )}
        </ul>

        <div className="grid gap-2">
          <div className="font-medium">If the checks pass but the list stays empty</div>
          <ol className="text-muted-foreground grid list-decimal gap-1.5 pl-5">
            <li>
              <strong className="text-foreground">Start broadcasting right before you search.</strong> On the
              watch: heart-rate glance → open its menu → <em>Broadcast Heart Rate</em>. Keep that screen
              showing; the watch only advertises while broadcasting, and some firmware stops when you leave
              the screen. (Also under{" "}
              <em>Settings → Sensors &amp; Accessories → Wrist Heart Rate → Broadcast During Activity</em>{" "}
              for use during workouts.)
            </li>
            <li>
              Hold the watch within a metre of the Mac. Don&apos;t pair it in macOS Bluetooth settings: if the
              Mac connects to it, Chrome can&apos;t see it.
            </li>
            <li>
              Try the wider search below. It lists <em>every</em> nearby Bluetooth device. If your Forerunner
              shows up here but not in the normal search, it&apos;s advertising without the heart-rate
              service. Pick it anyway; we connect and look for the service.
            </li>
            <li>
              Look at what Chrome sees: open{" "}
              <code className="text-foreground">chrome://bluetooth-internals</code> → <em>Devices</em> →{" "}
              <em>Start scan</em>. The Forerunner should appear with service UUID{" "}
              <code className="text-foreground">0x180D</code> while broadcasting.
            </li>
            <li>
              Check the site isn&apos;t blocked:{" "}
              <code className="text-foreground">chrome://settings/content/bluetoothDevices</code>.
            </li>
          </ol>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onScanAll} disabled={scanning}>
            <Radar aria-hidden /> Search all nearby devices
          </Button>
          <Button variant="ghost" onClick={refresh}>
            Re-run checks
          </Button>
        </div>
      </div>
    </details>
  );
}
