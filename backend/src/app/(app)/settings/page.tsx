import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { AccountSettings } from "@/components/settings/account-settings";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  return (
    <>
      <PageHeader title="Settings" description="Account, timezone and your data." />
      <AccountSettings name={user.name} email={user.email} timezone={user.timezone} />
    </>
  );
}
