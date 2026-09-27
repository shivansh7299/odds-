import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { MetricDetail } from "@/components/dashboard/metric-detail";
import { METRICS, metricFromSlug } from "@/lib/metrics/definitions";
import { requireUser } from "@/server/auth/session";
import { connectionState, rangeContext } from "@/server/dashboard/context";

export async function generateMetadata({ params }: PageProps<"/dashboard/[metric]">): Promise<Metadata> {
  const type = metricFromSlug((await params).metric);
  return { title: type ? METRICS[type].label : "Not found" };
}

export default async function MetricPage({ params, searchParams }: PageProps<"/dashboard/[metric]">) {
  const { metric } = await params;
  const type = metricFromSlug(metric);
  if (!type) notFound();

  const user = await requireUser(`/dashboard/${metric}`);
  const { range, ctx } = rangeContext(await searchParams, user.timezone);
  const conns = await connectionState(user.id);

  return (
    <>
      <DashboardHeader
        title={METRICS[type].label}
        range={range}
        today={ctx.today}
        simulated={conns.simulated}
      />
      <MetricDetail type={type} ctx={ctx} />
    </>
  );
}
