import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth/session";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  // Real (DB-verified) check, so a stale cookie can't cause a redirect loop.
  if (await getSession()) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Logo />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
