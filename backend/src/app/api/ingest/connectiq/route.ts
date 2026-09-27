import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrors } from "@/lib/errors";
import { readJson } from "@/server/http/body";
import { rateLimit } from "@/server/http/rate-limit";
import { ingestBatch } from "@/server/ingest/ingest";
import { ensurePushConnection } from "@/server/sources/connections";
import { authenticateDevice } from "@/server/sources/connectiq/pairing";
import { connectIqPayloadSchema, normalizeConnectIq } from "@/server/sources/connectiq/ingest";

export const dynamic = "force-dynamic";

/** POST /api/ingest/connectiq: data from a paired watch (Authorization: Bearer vs_…). */
export const POST = withErrors(async (request: Request) => {
  const device = await authenticateDevice(request);
  rateLimit(`ciq:${device.id}`, { perMinute: 60, burst: 20 });
  const payload = connectIqPayloadSchema.parse(await readJson(request, 64 * 1024));

  const target = await ensurePushConnection(device.user, "GARMIN_CONNECTIQ");
  const { samples, rejected } = await normalizeConnectIq(payload, target);
  const result = samples.length ? await ingestBatch(target, { samples }) : { samples: 0 };

  await db.ingestDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date(), ...(payload.model && { model: payload.model }) },
  });
  return NextResponse.json({ accepted: result.samples, rejected });
});
