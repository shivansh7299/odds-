<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VitalSync project notes

- Design and milestones: `docs/ARCHITECTURE.md`. Each milestone is reviewed by the user before the next starts.
- Prisma 7: client is generated to `src/generated/prisma` (import from `@/generated/prisma/client`), uses `@prisma/adapter-pg`; DB URL lives in `prisma.config.ts`.
- Server env is read only through `env()` in `src/lib/env.ts` (Zod-validated).
- `pnpm typecheck` runs `next typegen` first (needed for `LayoutProps`/`PageProps`).
- Target hardware is a Garmin Forerunner 265 + iPhone 15: no Web Bluetooth on iOS; Garmin Health API not available.
