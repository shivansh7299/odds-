import { describe, expect, it } from "vitest";
import { GET as getStream } from "@/app/api/stream/route";
import { realtimeBus } from "@/server/realtime/pg-bus";
import type { RealtimeEvent } from "@/server/realtime/events";
import { authedRequest, createUser } from "./helpers";

describe("realtime", () => {
  it("delivers events only to the target user's subscribers", async () => {
    const got: { a: RealtimeEvent[]; b: RealtimeEvent[] } = { a: [], b: [] };
    const offA = await realtimeBus.subscribe("user-a", (e) => got.a.push(e));
    const offB = await realtimeBus.subscribe("user-b", (e) => got.b.push(e));

    await realtimeBus.publish("user-a", { kind: "source", source: "MOCK" });
    await expect.poll(() => got.a.length, { timeout: 3000 }).toBe(1);
    expect(got.b).toHaveLength(0);
    offA();
    offB();
  });

  it("streams events to an authenticated SSE client", async () => {
    const { user, headers } = await createUser();
    const controller = new AbortController();
    const res = await getStream(authedRequest("/api/stream", headers, { signal: controller.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };

    await readUntil("event: ready");
    await realtimeBus.publish(user.id, { kind: "workouts", source: "MOCK" });
    await readUntil("event: workouts");
    expect(text).toContain('"kind":"workouts"');
    controller.abort();
    await reader.cancel();
  });
});
