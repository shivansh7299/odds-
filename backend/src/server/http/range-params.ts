import "server-only";
import { parseRange } from "@/lib/range";

/** Reads ?range=&from=&to= from a request URL in the user's timezone. */
export function rangeFromRequest(request: Request, tz: string) {
  const sp = new URL(request.url).searchParams;
  return parseRange({ range: sp.get("range"), from: sp.get("from"), to: sp.get("to") }, tz);
}
