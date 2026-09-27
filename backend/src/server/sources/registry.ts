import "server-only";
import type { SourceType } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { SOURCE_CATALOG } from "@/server/sources/catalog";
import type { SourceAdapter } from "@/server/sources/types";

const notYet = () => false;

export const SOURCES: Record<SourceType, SourceAdapter> = {
  MOCK: { info: SOURCE_CATALOG.MOCK, kind: "internal", isAvailable: () => env().ENABLE_MOCK_SOURCE },
  GARMIN_BLE: { info: SOURCE_CATALOG.GARMIN_BLE, kind: "push", isAvailable: () => true },
  GARMIN_CONNECTIQ: { info: SOURCE_CATALOG.GARMIN_CONNECTIQ, kind: "push", isAvailable: () => true },
  GARMIN_FIT: { info: SOURCE_CATALOG.GARMIN_FIT, kind: "file", isAvailable: () => true },
  GARMIN_HEALTH_API: { info: SOURCE_CATALOG.GARMIN_HEALTH_API, kind: "pull", isAvailable: notYet },
};

/** URL slug ↔ SourceType, e.g. /api/sources/mock */
export const SOURCE_SLUGS: Record<string, SourceType> = {
  mock: "MOCK",
  ble: "GARMIN_BLE",
  connectiq: "GARMIN_CONNECTIQ",
  fit: "GARMIN_FIT",
  "garmin-health": "GARMIN_HEALTH_API",
};
