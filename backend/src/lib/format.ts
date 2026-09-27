/** "just now", "4 min ago", "3 h ago", "2 d ago" */
export function formatAgo(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const nf = new Intl.NumberFormat("en-US");
export const formatNumber = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n)
    ? "—"
    : digits === 0
      ? nf.format(Math.round(n))
      : n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 452 → "7h 32m" */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function formatDuration(sec: number): string {
  return formatMinutes(Math.round(sec / 60));
}
