import { vi } from "vitest";

// `server-only` throws outside a React Server Components bundle; tests run in plain Node.
vi.mock("server-only", () => ({}));
