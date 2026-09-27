import type { Metadata } from "next";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { NoSourcesEmptyState } from "@/components/dashboard/empty-state";
import { SleepView } from "@/components/dashboard/sleep-view";
import { requireUser } from "@/server/auth/session";
import { connectionState, rangeContext } from "@/server/dashboard/context";

export const metadata: Metadata = { title: "Sleep" };

export default async function SleepPage({ searchParams }: PageProps<"/sleep">) {
  const user = await requireUser("/sleep");
  const { range, ctx } = rangeContext(await searchParams, user.timezone);
  const conns = await connectionState(user.id);
  return (
    <>
      <DashboardHeader title="Sleep" range={range} today={ctx.today} simulated={conns.simulated} />
      {conns.hasAny ? <SleepView ctx={ctx} /> : <NoSourcesEmptyState />}
    </>
  );
}
