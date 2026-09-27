import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateApiToken } from "@/server/api-access/tokens";
import { corsPreflight, withCors } from "@/server/http/cors";
import { SOURCE_CATALOG } from "@/server/sources/catalog";

export const dynamic = "force-dynamic";

/** GET /api/v1/me: who the key belongs to and which sources have data (used to test a connection). */
export const GET = withCors(async (request) => {
  const user = await authenticateApiToken(request);
  const conns = await db.sourceConnection.findMany({
    where: { userId: user.id },
    select: { source: true, status: true, lastDataAt: true },
  });
  return NextResponse.json({
    name: user.name,
    timezone: user.timezone,
    sources: conns.map((c) => ({
      source: c.source,
      label: SOURCE_CATALOG[c.source].label,
      status: c.status,
      lastDataAt: c.lastDataAt,
    })),
  });
});

export const OPTIONS = corsPreflight;
