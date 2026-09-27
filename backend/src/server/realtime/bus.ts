import type { RealtimeEvent } from "@/server/realtime/events";

export type Unsubscribe = () => void;

/**
 * Fan-out of per-user events. The Postgres implementation works across processes
 * (worker → web). Swap for Pusher/Ably when deploying to serverless.
 */
export interface RealtimeBus {
  publish(userId: string, event: RealtimeEvent): Promise<void>;
  subscribe(userId: string, handler: (event: RealtimeEvent) => void): Promise<Unsubscribe>;
}
