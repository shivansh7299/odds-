"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description?: React.ReactNode;
  href?: string;
  /** Chart area height in px, including axis labels. */
  height?: number;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyText?: string;
  chart: React.ReactNode;
  /** Accessible table twin of the chart. */
  table?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

/**
 * Consistent chrome for every chart: title, loading/empty/error states, and a
 * Chart | Table toggle so every value is readable without hover.
 */
export function ChartCard({
  title,
  description,
  href,
  height = 240,
  isLoading,
  isFetching,
  error,
  onRetry,
  isEmpty,
  emptyText = "No data in this range yet.",
  chart,
  table,
  footer,
  className,
}: Props) {
  const body = (content: React.ReactNode) =>
    isLoading ? (
      <Skeleton className="w-full" style={{ height }} />
    ) : error ? (
      <div className="flex flex-col items-center justify-center gap-3 text-center text-sm" style={{ height }}>
        <AlertTriangle className="text-destructive size-5" aria-hidden />
        <p className="text-muted-foreground">Couldn&apos;t load this chart.</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    ) : isEmpty ? (
      <div
        className="text-muted-foreground flex items-center justify-center rounded-md border border-dashed text-sm"
        style={{ height }}
      >
        {emptyText}
      </div>
    ) : (
      <div className={cn("transition-opacity", isFetching && "opacity-60")}>{content}</div>
    );

  return (
    <Card className={cn("min-w-0", className)}>
      <Tabs defaultValue="chart">
        <CardHeader>
          <CardTitle>
            {href ? (
              <Link href={href} className="group inline-flex items-center gap-1 hover:underline">
                {title}
                <ChevronRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ) : (
              title
            )}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
          {table && (
            <CardAction>
              <TabsList className="h-7">
                <TabsTrigger value="chart" className="px-2 text-xs">
                  Chart
                </TabsTrigger>
                <TabsTrigger value="table" className="px-2 text-xs">
                  Table
                </TabsTrigger>
              </TabsList>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="mt-4">
          <TabsContent value="chart">{body(chart)}</TabsContent>
          {table && (
            <TabsContent value="table">
              {body(
                <div className="overflow-auto rounded-md border" style={{ maxHeight: height }}>
                  {table}
                </div>,
              )}
            </TabsContent>
          )}
          {footer && <div className="text-muted-foreground mt-3 text-xs">{footer}</div>}
        </CardContent>
      </Tabs>
    </Card>
  );
}

/** Minimal accessible data table used as each chart's table view. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-card sticky top-0">
        <tr className="text-muted-foreground border-b text-left text-xs">
          {columns.map((c, i) => (
            <th key={c} scope="col" className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            {r.map((cell, j) => (
              <td key={j} className={cn("px-3 py-1.5", j > 0 && "text-right")}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
