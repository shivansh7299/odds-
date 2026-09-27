import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SeriesPanel } from "@/components/dashboard/panels";
import { BroadcastInstructions, LiveHeartRate } from "@/components/live/live-heart-rate";
import { requireUser } from "@/server/auth/session";
import { rangeContext } from "@/server/dashboard/context";

export const metadata: Metadata = { title: "Live" };

export default async function LivePage() {
  const user = await requireUser("/live");
  const { ctx } = rangeContext({ range: "today" }, user.timezone);

  return (
    <>
      <PageHeader
        title="Live"
        description="Second-by-second heart rate from your watch. Other devices see it here within seconds."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <LiveHeartRate />
        <BroadcastInstructions />
      </div>
      <div className="mt-4">
        <SeriesPanel
          type="HEART_RATE"
          ctx={ctx}
          bucket={60}
          title="Today, all sources"
          description="Updates live as readings are saved. The most precise source wins for each minute."
        />
      </div>
    </>
  );
}
