import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { readJson } from "@/server/http/body";
import { rateLimit } from "@/server/http/rate-limit";
import { approvePairing, approveSchema } from "@/server/sources/connectiq/pairing";

export const dynamic = "force-dynamic";

/** POST /api/devices/pair/approve: the signed-in user enters the code shown on the watch. */
export const POST = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`pair-approve:${user.id}`, { perMinute: 10 }); // limits code guessing
  const device = await approvePairing(user, approveSchema.parse(await readJson(request, 2048)));
  return NextResponse.json({ device }, { status: 201 });
});
