import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeTimezone } from "@/lib/timezone";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation/auth";

const DAY = 60 * 60 * 24;

export const auth = betterAuth({
  appName: "VitalSync",
  baseURL: env().BETTER_AUTH_URL,
  secret: env().BETTER_AUTH_SECRET,
  trustedOrigins: env().BETTER_AUTH_TRUSTED_ORIGINS,
  database: prismaAdapter(db, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    autoSignIn: true,
  },

  session: {
    expiresIn: 7 * DAY,
    updateAge: DAY, // sliding expiry: refreshed at most once a day
  },

  user: {
    // Requires the current password; all data cascades from the user row.
    deleteUser: { enabled: true },
    additionalFields: {
      timezone: { type: "string", required: false, defaultValue: "UTC", input: true },
    },
  },

  // Never trust a client-supplied timezone string as-is.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, timezone: normalizeTimezone(user.timezone) } }),
      },
      update: {
        before: async (user) =>
          "timezone" in user
            ? { data: { ...user, timezone: normalizeTimezone(user.timezone) } }
            : { data: user },
      },
    },
  },

  // In-memory limiter: fine for a single instance. Switch storage to "database" when scaling out.
  rateLimit: {
    enabled: env().NODE_ENV !== "test",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },

  plugins: [nextCookies()], // must stay last
});

export type Session = typeof auth.$Infer.Session;
