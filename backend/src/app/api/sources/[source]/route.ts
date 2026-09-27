import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, notFound, withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { removeSource, setSourcePaused } from "@/server/account/service";
import { enableMock } from "@/server/sources/mock/service";
import { SOURCE_CATALOG } from "@/server/sources/catalog";
import { SOURCE_SLUGS } from "@/server/sources/registry";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/sources/[source]">;

async function resolveSource(ctx: Ctx) {
  const { source: slug } = await ctx.params;
  const type = SOURCE_SLUGS[slug];
  if (!type) throw notFound("Source");
  return type;
}

/**
 * Connect the simulated source. Garmin sources connect through their own flows
 * (Live page, FIT upload, watch pairing), created on first data.
 */
export const POST = withErrors(async (request: Request, ctx: Ctx) => {
  const user = await requireApiUser(request);
  const type = await resolveSource(ctx);
  if (type !== "MOCK") {
    throw new AppError(
      400,
      "connect_via_flow",
      `${SOURCE_CATALOG[type].label} connects automatically when data arrives`,
    );
  }
  const conn = await enableMock(user.id);
  return NextResponse.json({ connection: { id: conn.id, status: conn.status } }, { status: 201 });
});

const patchSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) });

/** Pause / resume. */
export const PATCH = withErrors(async (request: Request, ctx: Ctx) => {
  const user = await requireApiUser(request);
  const type = await resolveSource(ctx);
  const { status } = patchSchema.parse(await request.json());
  await setSourcePaused(user.id, type, status === "PAUSED");
  return NextResponse.json({ ok: true });
});

/** Disconnect and delete this source's data. */
export const DELETE = withErrors(async (request: Request, ctx: Ctx) => {
  const user = await requireApiUser(request);
  await removeSource(user.id, await resolveSource(ctx));
  return new NextResponse(null, { status: 204 });
});
