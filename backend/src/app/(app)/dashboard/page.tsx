import type { Metadata } from "next";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { NoSourcesEmptyState } from "@/components/dashboard/empty-state";
import { requireUser } from "@/server/auth/session";
import { connectionState, rangeContext } from "@/server/dashboard/context";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const { range, ctx } = rangeContext(await searchParams, user.timezone);
  const conns = await connectionState(user.id);

  return (
    <>
      <DashboardHeader title="Dashboard" range={range} today={ctx.today} simulated={conns.simulated} />
      {conns.hasAny ? <DashboardView ctx={ctx} /> : <NoSourcesEmptyState />}
    </>
  );
}
