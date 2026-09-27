import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SourcesView } from "@/components/sources/sources-view";
import { requireUser } from "@/server/auth/session";
import { listSourcesForUser } from "@/server/sources/queries";

export const metadata: Metadata = { title: "Sources" };

export default async function SourcesPage() {
  const user = await requireUser();
  const sources = await listSourcesForUser(user.id);
  return (
    <>
      <PageHeader
        title="Sources"
        description="Where your data comes from. When sources overlap, the more precise one is shown."
      />
      <SourcesView initial={JSON.parse(JSON.stringify(sources))} />
    </>
  );
}
