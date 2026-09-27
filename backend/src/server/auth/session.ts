import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppError, unauthorized } from "@/lib/errors";
import { env } from "@/lib/env";
import { normalizeTimezone } from "@/lib/timezone";

type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];

/** The signed-in user with a guaranteed-valid IANA timezone. */
const withTimezone = (user: SessionUser) => ({ ...user, timezone: normalizeTimezone(user.timezone) });

/** The current session (deduplicated per request), or null. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** For pages/layouts: the signed-in user, or redirect to sign-in. */
export async function requireUser(nextPath?: string) {
  const session = await getSession();
  if (!session) {
    redirect(nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in");
  }
  return withTimezone(session.user);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense in depth for cookie-authenticated writes: when the browser sends
 * an Origin, it must be our own (the app URL or the host that served the request).
 * SameSite=Lax cookies already block most cross-site POSTs.
 */
function assertSameOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients / same-origin requests in some browsers
  const allowed = new Set([new URL(env().BETTER_AUTH_URL).origin, ...env().BETTER_AUTH_TRUSTED_ORIGINS]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host)
    allowed.add(
      `${request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")}://${host}`,
    );
  if (!allowed.has(origin)) throw new AppError(403, "bad_origin", "Cross-site request rejected");
}

/** For route handlers: the signed-in user, or throw a 401 AppError. */
export async function requireApiUser(request: Request) {
  assertSameOrigin(request);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw unauthorized();
  return withTimezone(session.user);
}
