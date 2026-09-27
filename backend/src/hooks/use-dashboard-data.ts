"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { MetricType, SourceType } from "@/generated/prisma/enums";
import { apiFetch } from "@/lib/api/fetcher";
import type { TrendPoint } from "@/server/analytics/trends";
import type { Overview, TrendField } from "@/server/analytics/overview";
import type { DaySummary, SeriesPoint, SleepNight, WorkoutRow } from "@/server/metrics/queries";

/**
 * Data hooks for the dashboard. `rangeQs` is the URL's range query string
 * (e.g. "range=7d"), so cache keys follow the URL. `keepPreviousData` holds the
 * last render while a new range loads instead of flashing skeletons.
 */
const common = { placeholderData: keepPreviousData } as const;

export type SeriesResponse = {
  type: MetricType;
  source: SourceType | null;
  bucketSec: number;
  points: SeriesPoint[];
};

export const useOverview = (rangeQs: string) =>
  useQuery({
    ...common,
    queryKey: ["overview", rangeQs],
    queryFn: () => apiFetch<Overview>(`/api/overview?${rangeQs}`),
  });

export const useSeries = (type: MetricType, rangeQs: string, bucket?: number) =>
  useQuery({
    ...common,
    queryKey: ["metrics", type, rangeQs, bucket ?? "auto"],
    queryFn: () =>
      apiFetch<SeriesResponse>(`/api/metrics?type=${type}&${rangeQs}${bucket ? `&bucket=${bucket}` : ""}`),
  });

export const useSummary = (rangeQs: string) =>
  useQuery({
    ...common,
    queryKey: ["summary", rangeQs],
    queryFn: () => apiFetch<{ days: DaySummary[] }>(`/api/summary?${rangeQs}`),
  });

export const useTrend = (field: TrendField, rangeQs: string) =>
  useQuery({
    ...common,
    queryKey: ["trends", field, rangeQs],
    queryFn: () => apiFetch<{ points: TrendPoint[] }>(`/api/analytics/trends?field=${field}&${rangeQs}`),
  });

export const useSleepNight = (date: string) =>
  useQuery({
    ...common,
    queryKey: ["sleep", date],
    queryFn: () => apiFetch<{ night: SleepNight | null }>(`/api/sleep?date=${date}`),
  });

export const useWorkouts = (rangeQs: string, limit = 10) =>
  useInfiniteQuery({
    queryKey: ["workouts", rangeQs, limit],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<{ workouts: WorkoutRow[]; nextCursor: string | null }>(
        `/api/workouts?${rangeQs}&limit=${limit}${pageParam ? `&cursor=${pageParam}` : ""}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
