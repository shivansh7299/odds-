import "server-only";
import { env } from "@/lib/env";
import { toErrorResponse } from "@/lib/errors";

/**
 * CORS for the read-only /api/v1 API. Only configured origins
 * (VITALSYNC_CORS_ORIGINS) get Access-Control-Allow-Origin. Auth is a Bearer
 * API key, never cookies, so credentials are not allowed cross-origin.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const base: Record<string, string> = { Vary: "Origin" };
  if (!origin || !env().VITALSYNC_CORS_ORIGINS.includes(origin)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    // ngrok-skip-browser-warning: lets browsers reach a free ngrok tunnel without its HTML interstitial
    "Access-Control-Allow-Headers": "Authorization, Content-Type, ngrok-skip-browser-warning",
    "Access-Control-Max-Age": "600",
  };
}

export function withCors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let res: Response;
    try {
      res = await handler(request);
    } catch (err) {
      res = toErrorResponse(err);
    }
    for (const [k, v] of Object.entries(corsHeaders(request))) res.headers.set(k, v);
    return res;
  };
}

/** Preflight responder for OPTIONS. */
export function corsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
