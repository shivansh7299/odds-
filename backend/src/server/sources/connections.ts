import "server-only";
import type { SourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { IngestTarget } from "@/server/ingest/ingest";
import { realtimeBus } from "@/server/realtime/pg-bus";

/**
 * Get-or-create the user's connection for a push source (created on first data).
 * Refuses to write into a paused/revoked connection.
 */
export async function ensurePushConnection(
  user: { id: string; timezone: string },
  source: SourceType,
): Promise<IngestTarget> {
  const existing = await db.sourceConnection.findUnique({
    where: { userId_source: { userId: user.id, source } },
  });
  const conn =
    existing ??
    (await db.sourceConnection
      .create({ data: { userId: user.id, source, status: "ACTIVE" } })
      .catch(async () =>
        // lost a creation race with a concurrent request
        db.sourceConnection.findUniqueOrThrow({ where: { userId_source: { userId: user.id, source } } }),
      ));
  if (!existing) await realtimeBus.publish(user.id, { kind: "source", source });
  if (conn.status !== "ACTIVE") {
    throw new AppError(
      409,
      "source_inactive",
      `This source is ${conn.status.toLowerCase()}. Resume it on the Sources page.`,
    );
  }
  return { id: conn.id, userId: user.id, source, timezone: user.timezone };
}
