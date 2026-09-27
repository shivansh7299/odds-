import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { readJson } from "@/server/http/body";
import { clientIp, rateLimit } from "@/server/http/rate-limit";
import { pollPairing, pollSchema } from "@/server/sources/connectiq/pairing";

export const dynamic = "force-dynamic";

/** POST /api/devices/pair/poll (called by the watch every few seconds). */
export const POST = withErrors(async (request: Request) => {
  rateLimit(`pair-poll:${clientIp(request)}`, { perMinute: 60 });
  const result = await pollPairing(pollSchema.parse(await readJson(request, 2048)));
  const status = result.status === "approved" ? 200 : result.status === "pending" ? 202 : 429;
  return NextResponse.json(result, { status });
});
