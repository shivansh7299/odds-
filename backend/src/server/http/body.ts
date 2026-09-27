import "server-only";
import { AppError } from "@/lib/errors";

/** Reads a JSON body, rejecting anything larger than `maxBytes` (413) or malformed (400). */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes`);

  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "bad_request", "Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError(413, "payload_too_large", `Body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "bad_json", "Body is not valid JSON");
  }
}
