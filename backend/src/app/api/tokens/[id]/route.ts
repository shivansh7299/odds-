import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { revokeApiToken } from "@/server/api-access/tokens";

export const dynamic = "force-dynamic";

export const DELETE = withErrors(async (request: Request, ctx: RouteContext<"/api/tokens/[id]">) => {
  const user = await requireApiUser(request);
  await revokeApiToken(user.id, (await ctx.params).id);
  return new NextResponse(null, { status: 204 });
});
