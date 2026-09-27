"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseHeartRateMeasurement } from "@/lib/ble/heart-rate";

export type BleStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type LiveReading = { ts: number; bpm: number };

const WINDOW_MS = 5 * 60_000; // keep 5 minutes on screen
const UPLOAD_EVERY_MS = 10_000;
const MAX_PENDING = 3_600; // ~1 h of readings if the server is unreachable
const MAX_BATCH = 900;
const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000];

const noopSubscribe = () => () => {};

function bluetoothSupport(): { ok: true } | { ok: false; reason: string } {
  if (typeof navigator === "undefined") return { ok: false, reason: "Not in a browser." };
  if (!window.isSecureContext) return { ok: false, reason: "Web Bluetooth needs HTTPS (or localhost)." };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!("bluetooth" in navigator)) {
    return {
      ok: false,
      reason: ios
        ? "iPhone and iPad browsers don't support Web Bluetooth. Use Chrome or Edge on your Mac; this page still shows live data from there."
        : "This browser doesn't support Web Bluetooth. Use Chrome or Edge on desktop or Android.",
    };
  }
  return { ok: true };
}

/**
 * Connects to a device exposing the standard BLE Heart Rate service (the
 * Forerunner's "Broadcast Heart Rate" mode), shows readings immediately, and
 * uploads them in batches. Reconnects with backoff if the link drops.
 */
export function useBleHeartRate() {
  const [status, setStatus] = useState<BleStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [readings, setReadings] = useState<LiveReading[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const device = useRef<BluetoothDevice | null>(null);
  const characteristic = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
  const pending = useRef<LiveReading[]>([]);
  const manualDisconnect = useRef(false);
  const attempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [pendingCount, setPendingCount] = useState(0);
  // Browser capability is only knowable on the client; the server snapshot says "supported".
  const unsupportedReason = useSyncExternalStore(
    noopSubscribe,
    () => {
      const support = bluetoothSupport();
      return support.ok ? null : support.reason;
    },
    () => null,
  );

  const onMeasurement = useCallback((event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    let m;
    try {
      m = parseHeartRateMeasurement(value);
    } catch {
      return;
    }
    if (m.bpm < 25 || m.bpm > 250 || m.contact === false) return; // no skin contact / junk
    const reading = { ts: Date.now(), bpm: m.bpm };
    pending.current.push(reading);
    if (pending.current.length > MAX_PENDING) pending.current.splice(0, pending.current.length - MAX_PENDING);
    setPendingCount(pending.current.length);
    setReadings((prev) => {
      const cutoff = reading.ts - WINDOW_MS;
      const next = prev.length && prev[0]!.ts < cutoff ? prev.filter((r) => r.ts >= cutoff) : prev.slice();
      next.push(reading);
      return next;
    });
  }, []);

  const subscribe = useCallback(
    async (d: BluetoothDevice) => {
      const server = await d.gatt!.connect();
      const service = await server.getPrimaryService("heart_rate");
      const ch = await service.getCharacteristic("heart_rate_measurement");
      ch.addEventListener("characteristicvaluechanged", onMeasurement);
      await ch.startNotifications();
      characteristic.current = ch;
      attempt.current = 0;
      setStatus("connected");
      setError(null);
    },
    [onMeasurement],
  );

  const onDisconnectedRef = useRef<() => void>(() => {});
  const onDisconnected = useCallback(() => {
    characteristic.current?.removeEventListener("characteristicvaluechanged", onMeasurement);
    characteristic.current = null;
    if (manualDisconnect.current || !device.current) {
      setStatus("disconnected");
      return;
    }
    const delay = RECONNECT_DELAYS[attempt.current];
    if (delay === undefined) {
      setStatus("disconnected");
      setError("Lost the watch. Check that Broadcast Heart Rate is still on, then reconnect.");
      return;
    }
    attempt.current += 1;
    setStatus("reconnecting");
    reconnectTimer.current = setTimeout(() => {
      if (device.current) subscribe(device.current).catch(() => onDisconnectedRef.current());
    }, delay);
  }, [onMeasurement, subscribe]);
  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
  }, [onDisconnected]);

  /**
   * "heart-rate": devices advertising the Heart Rate service OR named like a Garmin
   *   watch (some firmware advertises the name but leaves the service UUID out of the
   *   advertisement; the service is still there once connected).
   * "all": every nearby BLE device, for diagnosis.
   */
  const connect = useCallback(
    async (mode: "heart-rate" | "all" = "heart-rate") => {
      if (!bluetoothSupport().ok) return;
      setError(null);
      manualDisconnect.current = false;
      try {
        setStatus("requesting");
        const d = await navigator.bluetooth.requestDevice(
          mode === "all"
            ? { acceptAllDevices: true, optionalServices: ["heart_rate"] }
            : {
                filters: [
                  { services: ["heart_rate"] },
                  { namePrefix: "Forerunner" },
                  { namePrefix: "Garmin" },
                  { namePrefix: "FR" },
                ],
                optionalServices: ["heart_rate"],
              },
        );
        device.current?.removeEventListener("gattserverdisconnected", onDisconnected);
        device.current = d;
        setDeviceName(d.name ?? "Heart rate sensor");
        d.addEventListener("gattserverdisconnected", onDisconnected);
        setStatus("connecting");
        await subscribe(d);
      } catch (err) {
        const e = err as DOMException;
        console.warn("[ble] connect failed", e.name, e.message);
        setLastError(`${e.name}: ${e.message}`);
        if (e.name === "NotFoundError" && /cancel/i.test(e.message)) {
          setStatus(device.current ? "disconnected" : "idle"); // user closed the picker
          return;
        }
        setStatus("error");
        setError(
          e.name === "NotFoundError" && /service/i.test(e.message)
            ? "That device isn't broadcasting heart rate. On the watch, turn on Broadcast Heart Rate and keep that screen open."
            : e.name === "NotFoundError"
              ? "No device selected."
              : e.name === "SecurityError"
                ? "Bluetooth is blocked for this site. Check the site permissions (lock icon in the address bar)."
                : e.name === "NotAllowedError"
                  ? "Bluetooth access was denied. Check macOS System Settings → Privacy & Security → Bluetooth → Google Chrome."
                  : e.name === "NetworkError"
                    ? "Found the watch but couldn't connect. Keep it close, make sure broadcasting is on, and try again."
                    : (e.message ?? "Bluetooth connection failed."),
        );
      }
    },
    [onDisconnected, subscribe],
  );

  const disconnect = useCallback(() => {
    manualDisconnect.current = true;
    clearTimeout(reconnectTimer.current);
    device.current?.gatt?.disconnect();
    setStatus("disconnected");
  }, []);

  // Batch upload; failed batches stay queued and are retried on the next tick.
  useEffect(() => {
    let inFlight = false;
    const flush = async () => {
      if (inFlight || pending.current.length === 0) return;
      inFlight = true;
      const batch = pending.current.slice(0, MAX_BATCH);
      try {
        const res = await fetch("/api/ingest/ble", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples: batch }),
          keepalive: true,
        });
        if (res.ok) {
          pending.current.splice(0, batch.length);
          setPendingCount(pending.current.length);
          const body = (await res.json()) as { accepted: number };
          setUploaded((n) => n + body.accepted);
          setUploadError(null);
        } else if (res.status === 400 || res.status === 422) {
          pending.current.splice(0, batch.length); // unrecoverable batch: drop it
          setPendingCount(pending.current.length);
        } else {
          const body = await res.json().catch(() => null);
          setUploadError(body?.error?.message ?? `Upload failed (${res.status}). Retrying…`);
        }
      } catch {
        setUploadError("Offline. Readings are kept and will upload when you're back.");
      } finally {
        inFlight = false;
      }
    };
    const id = setInterval(flush, UPLOAD_EVERY_MS);
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, []);

  useEffect(
    () => () => {
      manualDisconnect.current = true;
      clearTimeout(reconnectTimer.current);
      device.current?.gatt?.disconnect();
    },
    [],
  );

  return {
    status: unsupportedReason ? ("unsupported" as const) : status,
    error,
    unsupportedReason,
    deviceName,
    readings,
    current: readings.at(-1) ?? null,
    pendingCount,
    uploaded,
    uploadError,
    lastError,
    connect,
    disconnect,
  };
}
