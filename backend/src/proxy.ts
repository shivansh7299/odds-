import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic check only: redirects visitors with no session cookie away from app
 * pages. The real authorization happens in (app)/layout.tsx and every route handler.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/live/:path*",
    "/sleep/:path*",
    "/workouts/:path*",
    "/sources/:path*",
    "/settings/:path*",
  ],
};
