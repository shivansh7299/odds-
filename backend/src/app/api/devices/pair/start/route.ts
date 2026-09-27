import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { readJson } from "@/server/http/body";
import { clientIp, rateLimit } from "@/server/http/rate-limit";
import { startPairing, startSchema } from "@/server/sources/connectiq/pairing";

export const dynamic = "force-dynamic";

/** POST /api/devices/pair/start (called by the watch; no session). */
export const POST = withErrors(async (request: Request) => {
  rateLimit(`pair-start:${clientIp(request)}`, { perMinute: 10 });
  const input = startSchema.parse((await readJson(request, 2048).catch(() => ({}))) ?? {});
  return NextResponse.json(await startPairing(input), { status: 201 });
});
