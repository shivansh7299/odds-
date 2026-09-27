"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNow } from "@/hooks/use-now";
import { apiFetch } from "@/lib/api/fetcher";
import { formatAgo } from "@/lib/format";

type Token = { id: string; name: string; tokenPrefix: string; lastUsedAt: string | null; createdAt: string };

/** Create/revoke read-only API keys for other apps (e.g. the Pulse Check site). */
export function ApiKeys() {
  const queryClient = useQueryClient();
  const now = useNow();
  const [name, setName] = useState("Pulse Check");
  const [fresh, setFresh] = useState<string | null>(null);

  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => apiFetch<{ tokens: Token[] }>("/api/tokens"),
  });

  const create = useMutation({
    mutationFn: (n: string) =>
      apiFetch<{ token: Token & { token: string } }>("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: n }),
      }),
    onSuccess: ({ token }) => {
      setFresh(token.token);
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("API key revoked.");
      queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys for other apps</CardTitle>
        <CardDescription>
          Read-only keys that let another app (like the Pulse Check site) load your data and live heart rate.
          They can&apos;t change anything. Revoke a key to cut off access immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {fresh && (
          <div className="bg-muted/40 grid gap-2 rounded-md border border-[var(--status-good)]/40 p-3 text-sm">
            <div className="font-medium">Copy your new key now. It won&apos;t be shown again.</div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={fresh}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(fresh);
                  toast.success("Copied");
                }}
              >
                <Copy aria-hidden /> Copy
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setFresh(null)}>
              Done
            </Button>
          </div>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-56"
            />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
            Create key
          </Button>
        </form>

        {!!tokens.data?.tokens.length && (
          <ul className="grid gap-2 text-sm" aria-label="API keys">
            {tokens.data.tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <KeyRound className="text-muted-foreground size-4" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="text-muted-foreground text-xs">
                    <span className="font-mono">{t.tokenPrefix}…</span> ·{" "}
                    {t.lastUsedAt ? `used ${formatAgo(t.lastUsedAt, now)}` : "never used"}
                  </div>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Revoke ${t.name}`}
                  disabled={revoke.isPending}
                  onClick={() =>
                    confirm(`Revoke "${t.name}"? Apps using it stop working immediately.`) &&
                    revoke.mutate(t.id)
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
