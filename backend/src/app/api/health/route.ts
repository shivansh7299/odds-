import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database reachability, for Docker/Railway health checks. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch (err) {
    console.error("[health] database check failed", err);
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
