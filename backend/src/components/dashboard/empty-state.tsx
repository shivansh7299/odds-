import Link from "next/link";
import { Cable } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function NoSourcesEmptyState() {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="bg-muted flex size-12 items-center justify-center rounded-full">
        <Cable className="text-muted-foreground size-5" aria-hidden />
      </span>
      <div className="max-w-md">
        <h2 className="text-lg font-semibold">Connect a data source</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Your dashboard fills in as soon as data arrives. Garmin sources are coming in the next milestones;
          you can enable simulated data now to explore every chart.
        </p>
      </div>
      <Link href="/sources" className={buttonVariants()}>
        Go to Sources
      </Link>
    </Card>
  );
}
