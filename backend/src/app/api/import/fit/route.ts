import { NextResponse } from "next/server";
import { AppError, withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { rateLimit } from "@/server/http/rate-limit";
import { listImports, MAX_UPLOAD_BYTES, queueImport } from "@/server/sources/fit/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/import/fit: recent imports. */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  return NextResponse.json({ imports: await listImports(user.id) });
});

/** POST /api/import/fit: multipart upload with one `file` (.fit or .zip). */
export const POST = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`fit:${user.id}`, { perMinute: 30, burst: 30 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024 * 1024) {
    throw new AppError(413, "payload_too_large", "Upload is larger than 250 MB");
  }
  const form = await request.formData().catch(() => {
    throw new AppError(400, "bad_request", "Expected multipart/form-data with a `file` field");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "bad_request", "Missing `file`");
  const { job, duplicate } = await queueImport(user, file);
  return NextResponse.json({ job, duplicate }, { status: duplicate ? 200 : 202 });
});
