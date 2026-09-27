import "server-only";
import { Client } from "pg";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { RealtimeBus, Unsubscribe } from "@/server/realtime/bus";
import { envelopeSchema, type RealtimeEvent } from "@/server/realtime/events";

export const CHANNEL = "vitalsync_events";

type Handler = (event: RealtimeEvent) => void;

/**
 * One LISTEN connection per process; events are routed to in-process subscribers
 * by userId. Reconnects with backoff if the connection drops.
 */
export class PgRealtimeBus implements RealtimeBus {
  private handlers = new Map<string, Set<Handler>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retryMs = 1_000;

  async publish(userId: string, event: RealtimeEvent) {
    const payload = JSON.stringify({ userId, event });
    await db.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  }

  async subscribe(userId: string, handler: Handler): Promise<Unsubscribe> {
    await this.ensureListening();
    let set = this.handlers.get(userId);
    if (!set) this.handlers.set(userId, (set = new Set()));
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(userId);
    };
  }

  private ensureListening(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async connect() {
    const client = new Client({ connectionString: env().DATABASE_URL });
    client.on("notification", (msg) => this.dispatch(msg.payload));
    client.on("error", (err) => {
      console.error("[realtime] listener error", err.message);
      this.reconnect(client);
    });
    client.on("end", () => this.reconnect(client));
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
    this.retryMs = 1_000;
  }

  private reconnect(dead: Client) {
    if (this.client !== dead) return;
    this.client = null;
    dead.removeAllListeners();
    dead.end().catch(() => {});
    if (this.handlers.size === 0) return; // reconnect lazily on next subscribe
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    setTimeout(
      () => this.ensureListening().catch((e) => console.error("[realtime] reconnect failed", e)),
      delay,
    );
  }

  private dispatch(payload: string | undefined) {
    if (!payload) return;
    let parsed;
    try {
      parsed = envelopeSchema.safeParse(JSON.parse(payload));
    } catch {
      return;
    }
    if (!parsed.success) return;
    const handlers = this.handlers.get(parsed.data.userId);
    handlers?.forEach((h) => {
      try {
        h(parsed.data.event);
      } catch (err) {
        console.error("[realtime] handler error", err);
      }
    });
  }
}

const globalForBus = globalThis as unknown as { realtimeBus?: RealtimeBus };

export const realtimeBus: RealtimeBus = globalForBus.realtimeBus ?? new PgRealtimeBus();
globalForBus.realtimeBus = realtimeBus;
