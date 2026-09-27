import Link from "next/link";
import { Bluetooth, FileUp, Watch } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/auth/session";

const sources = [
  {
    icon: Bluetooth,
    title: "Live heart rate",
    body: "Stream Broadcast Heart Rate from your watch over Web Bluetooth (Chrome/Edge on desktop).",
  },
  {
    icon: Watch,
    title: "Connect IQ sync",
    body: "A companion watch app sends HR, HRV, steps, calories and SpO₂ through Garmin Connect.",
  },
  {
    icon: FileUp,
    title: "FIT import",
    body: "Upload FIT files or a Garmin Connect export to backfill sleep, workouts and history.",
  },
];

export default async function Home() {
  const session = await getSession();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <nav className="flex items-center justify-between">
        <Logo />
        {session ? (
          <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
            Open dashboard
          </Link>
        ) : (
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost" })}>
            Sign in
          </Link>
        )}
      </nav>

      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your Garmin data, live and in one place.
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Heart rate, HRV, steps, calories, SpO₂, sleep and workouts, stored in your own database and charted
          in near real time.
        </p>
        <div className="flex gap-2">
          <Link href={session ? "/dashboard" : "/sign-up"} className={buttonVariants({ size: "lg" })}>
            {session ? "Go to dashboard" : "Get started"}
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Data sources">
        {sources.map(({ icon: Icon, title, body }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-muted-foreground size-5" aria-hidden />
              <CardTitle>{title}</CardTitle>
              <CardDescription>{body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}
