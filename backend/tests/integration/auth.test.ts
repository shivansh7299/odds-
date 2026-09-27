import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireApiUser } from "@/server/auth/session";
import { authedRequest, createUser } from "./helpers";

describe("auth", () => {
  it("sign-up stores a hashed password, the timezone, and a session", async () => {
    const { user } = await createUser({ timezone: "Asia/Kolkata" });

    const dbUser = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { accounts: true } });
    expect(dbUser.timezone).toBe("Asia/Kolkata");
    expect(dbUser.accounts[0]?.password).toBeTruthy();
    expect(dbUser.accounts[0]?.password).not.toContain("correct-horse-battery");
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("falls back to UTC for an invalid timezone", async () => {
    const { user } = await createUser({ timezone: "Not/AZone" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).timezone).toBe("UTC");
  });

  it("rejects a wrong password", async () => {
    const { user } = await createUser();
    const res = await auth.api.signInEmail({
      body: { email: user.email, password: "wrong-password" },
      asResponse: true,
    });
    expect(res.status).toBe(401);
  });

  it("requireApiUser accepts a valid session and rejects none", async () => {
    const { user, headers } = await createUser();
    await expect(requireApiUser(authedRequest("/api/x", headers))).resolves.toMatchObject({ id: user.id });
    await expect(requireApiUser(new Request("http://localhost:3000/api/x"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("sign-out invalidates the session", async () => {
    const { headers } = await createUser();
    await auth.api.signOut({ headers });
    await expect(requireApiUser(authedRequest("/api/x", headers))).rejects.toMatchObject({ status: 401 });
  });
});

describe("CSRF origin check", () => {
  it("rejects cookie-authenticated writes from another origin", async () => {
    const { headers } = await createUser();
    const evil = authedRequest("/api/x", headers, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    await expect(requireApiUser(evil)).rejects.toMatchObject({ status: 403 });
    const ours = authedRequest("/api/x", headers, {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    await expect(requireApiUser(ours)).resolves.toBeTruthy();
    const read = authedRequest("/api/x", headers, { headers: { origin: "https://evil.example" } });
    await expect(requireApiUser(read)).resolves.toBeTruthy(); // reads are not state-changing
  });
});
