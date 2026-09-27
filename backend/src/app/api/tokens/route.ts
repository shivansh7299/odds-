import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { readJson } from "@/server/http/body";
import { rateLimit } from "@/server/http/rate-limit";
import { createApiToken, createTokenSchema, listApiTokens } from "@/server/api-access/tokens";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  return NextResponse.json({ tokens: await listApiTokens(user.id) });
});

/** POST /api/tokens { name }: returns the key once. */
export const POST = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`tokens:${user.id}`, { perMinute: 10 });
  const { name } = createTokenSchema.parse(await readJson(request, 1024));
  return NextResponse.json({ token: await createApiToken(user.id, name) }, { status: 201 });
});
