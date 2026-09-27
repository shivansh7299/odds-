import { Logo } from "@/components/logo";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { NavLinks } from "@/components/app-shell/nav-links";
import { UserMenu } from "@/components/app-shell/user-menu";
import { LiveIndicator } from "@/components/realtime/live-indicator";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <RealtimeProvider>
      <div className="flex min-h-svh w-full">
        <aside className="bg-sidebar sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r px-3 py-5 md:flex">
          <Logo href="/dashboard" className="px-3" />
          <NavLinks />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/85 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur sm:px-6">
            <div className="md:hidden">
              <MobileNav />
            </div>
            <Logo href="/dashboard" className="md:hidden" />
            <div className="ml-auto flex items-center gap-3">
              <LiveIndicator />
              <UserMenu name={user.name} email={user.email} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </RealtimeProvider>
  );
}
