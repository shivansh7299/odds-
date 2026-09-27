"use client";

import { useEffect, useState } from "react";

/** Current time, re-rendering every `intervalMs` (for "3 min ago" labels). */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
