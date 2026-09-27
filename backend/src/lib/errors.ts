import { NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/log";

/** An error that is safe to show to API clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () => new AppError(401, "unauthorized", "Sign in required");
export const forbidden = () => new AppError(403, "forbidden", "Not allowed");
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export function toErrorResponse(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request", details: z.flattenError(err) } },
      { status: 400 },
    );
  }
  log.error("unhandled api error", { err });
  return NextResponse.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500 },
  );
}

/** Wraps a route handler so thrown AppError / ZodError become JSON responses. */
export function withErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
