import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { revokeDevice } from "@/server/sources/connectiq/pairing";

export const dynamic = "force-dynamic";

/** DELETE /api/devices/:id: revoke a watch's token immediately. */
export const DELETE = withErrors(async (request: Request, ctx: RouteContext<"/api/devices/[id]">) => {
  const user = await requireApiUser(request);
  await revokeDevice(user.id, (await ctx.params).id);
  return new NextResponse(null, { status: 204 });
});
