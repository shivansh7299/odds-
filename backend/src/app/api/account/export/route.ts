import { withErrors } from "@/lib/errors";
import { exportStream } from "@/server/account/service";
import { requireApiUser } from "@/server/auth/session";
import { rateLimit } from "@/server/http/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/account/export: everything we store about you, as one JSON file. */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`export:${user.id}`, { perMinute: 2 });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(exportStream(user.id), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="vitalsync-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
