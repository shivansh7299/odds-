"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during SSR and before hydration; true once React is interactive. */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
