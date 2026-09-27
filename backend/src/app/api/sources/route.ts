import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { listSourcesForUser } from "@/server/sources/queries";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  return NextResponse.json({ sources: await listSourcesForUser(user.id) });
});
