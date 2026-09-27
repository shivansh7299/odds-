import { auth } from "@/lib/auth";

let counter = 0;

/** Creates a user via Better Auth and returns request headers carrying its session cookie. */
export async function createUser(overrides: { timezone?: string } = {}) {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const res = await auth.api.signUpEmail({
    body: { name: `User ${counter}`, email, password: "correct-horse-battery", ...overrides },
    asResponse: true,
  });
  if (!res.ok) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string; email: string; timezone: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { user: body.user, headers: new Headers({ cookie }) };
}

export function authedRequest(url: string, headers: Headers, init: RequestInit = {}) {
  return new Request(new URL(url, "http://localhost:3000"), {
    ...init,
    headers: { ...Object.fromEntries(headers), ...(init.headers as Record<string, string> | undefined) },
  });
}
