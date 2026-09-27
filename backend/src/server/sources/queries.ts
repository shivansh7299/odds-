import "server-only";
import type { SourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_CATALOG } from "@/server/sources/catalog";
import { SOURCES } from "@/server/sources/registry";

/** Client-safe view of every source and the user's connection to it (never tokens). */
export async function listSourcesForUser(userId: string) {
  const connections = await db.sourceConnection.findMany({
    where: { userId },
    select: {
      id: true,
      source: true,
      status: true,
      lastDataAt: true,
      lastSyncedAt: true,
      lastError: true,
      createdAt: true,
      syncRuns: {
        orderBy: { startedAt: "desc" },
        take: 5,
        select: {
          id: true,
          trigger: true,
          status: true,
          recordsUpserted: true,
          error: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  const byType = new Map(connections.map((c) => [c.source, c]));

  return (Object.keys(SOURCE_CATALOG) as SourceType[])
    .filter((t) => t !== "GARMIN_HEALTH_API")
    .sort((a, b) => SOURCE_CATALOG[a].priority - SOURCE_CATALOG[b].priority)
    .map((type) => ({
      ...SOURCE_CATALOG[type],
      available: SOURCES[type].isAvailable(),
      connection: byType.get(type) ?? null,
    }));
}

export type SourceListItem = Awaited<ReturnType<typeof listSourcesForUser>>[number];
