import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(254));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX),
});

export const signUpSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(80),
    email,
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;

/**
 * Only allow same-origin relative paths as post-login redirects, so `?next=`
 * can't be abused as an open redirect (e.g. `//evil.com`, `/\evil.com`).
 */
export function safeRedirectPath(next: unknown, fallback = "/dashboard"): string {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\") || /[\r\n\t]/.test(next)) return fallback;
  return next;
}

/** Field → first error message, for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
