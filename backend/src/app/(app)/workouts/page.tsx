import type { Metadata } from "next";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { NoSourcesEmptyState } from "@/components/dashboard/empty-state";
import { WorkoutsView } from "@/components/dashboard/workouts-view";
import { requireUser } from "@/server/auth/session";
import { connectionState, rangeContext } from "@/server/dashboard/context";

export const metadata: Metadata = { title: "Workouts" };

export default async function WorkoutsPage({ searchParams }: PageProps<"/workouts">) {
  const user = await requireUser("/workouts");
  const { range, ctx } = rangeContext(await searchParams, user.timezone);
  const conns = await connectionState(user.id);
  return (
    <>
      <DashboardHeader title="Workouts" range={range} today={ctx.today} simulated={conns.simulated} />
      {conns.hasAny ? <WorkoutsView ctx={ctx} /> : <NoSourcesEmptyState />}
    </>
  );
}
