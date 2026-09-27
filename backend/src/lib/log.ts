/**
 * Minimal structured logger: JSON lines in production (for Railway/Fly log search),
 * readable lines in development. Never pass secrets or health values to it.
 */
type Level = "debug" | "info" | "warn" | "error";
const pretty = process.env.NODE_ENV !== "production";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const err = fields?.err instanceof Error ? fields.err : undefined;
  const rest = { ...fields, ...(err && { err: { name: err.name, message: err.message, stack: err.stack } }) };
  if (pretty) {
    const line = `[${level}] ${msg}${fields ? " " + JSON.stringify({ ...rest, err: err?.message }) : ""}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    if (err?.stack && level === "error") console.error(err.stack);
    return;
  }
  const out = JSON.stringify({ t: new Date().toISOString(), level, msg, ...rest });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(out + "\n");
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
