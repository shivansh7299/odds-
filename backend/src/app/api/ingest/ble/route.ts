import { NextResponse } from "next/server";
import { AppError, withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { readJson } from "@/server/http/body";
import { rateLimit } from "@/server/http/rate-limit";
import { ingestBatch } from "@/server/ingest/ingest";
import { bleBatchSchema, normalizeBleBatch } from "@/server/sources/ble/ingest";
import { ensurePushConnection } from "@/server/sources/connections";

export const dynamic = "force-dynamic";

/** POST /api/ingest/ble: batches of live heart rate from the browser's Web Bluetooth session. */
export const POST = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`ble:${user.id}`, { perMinute: 30, burst: 10 });

  const batch = bleBatchSchema.parse(await readJson(request, 64 * 1024));
  const { samples, rejected } = normalizeBleBatch(batch);
  if (samples.length === 0)
    throw new AppError(422, "no_valid_samples", "All samples were outside the accepted time window");

  const target = await ensurePushConnection(user, "GARMIN_BLE");
  const result = await ingestBatch(target, { samples });
  return NextResponse.json({ accepted: result.samples, rejected });
});
