import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { FitImport } from "@/components/import/fit-import";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Import FIT files" };

export default async function ImportPage() {
  await requireUser("/sources/import");
  return (
    <>
      <PageHeader
        title="Import FIT files"
        description="Backfill sleep, workouts, HRV, SpO₂ and all-day data from your watch."
      />
      <FitImport />
    </>
  );
}
