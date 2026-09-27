"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, Watch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNow } from "@/hooks/use-now";
import { apiFetch } from "@/lib/api/fetcher";
import { formatAgo } from "@/lib/format";

type Device = {
  id: string;
  name: string;
  model: string | null;
  tokenPrefix: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Pair a watch by typing the code it shows; list and revoke paired watches. */
export function ConnectIqDevices() {
  const queryClient = useQueryClient();
  const now = useNow();
  const [code, setCode] = useState("");

  const devices = useQuery({
    queryKey: ["sources", "devices"],
    queryFn: () => apiFetch<{ devices: Device[] }>("/api/devices"),
  });

  const approve = useMutation({
    mutationFn: (userCode: string) =>
      apiFetch<{ device: { name: string } }>("/api/devices/pair/approve", {
        method: "POST",
        body: JSON.stringify({ userCode }),
      }),
    onSuccess: ({ device }) => {
      setCode("");
      toast.success(`${device.name} approved. The watch finishes pairing within a few seconds.`);
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/devices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Watch disconnected. It can no longer send data.");
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const active = devices.data?.devices.filter((d) => !d.revokedAt) ?? [];

  return (
    <div className="grid gap-3">
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) approve.mutate(code);
        }}
      >
        <Label htmlFor="pair-code">Pair a watch</Label>
        <div className="flex gap-2">
          <Input
            id="pair-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            className="font-mono tracking-widest uppercase"
            aria-describedby="pair-code-hint"
          />
          <Button type="submit" disabled={approve.isPending || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
            {approve.isPending && <Loader2 className="animate-spin" aria-hidden />}
            Approve
          </Button>
        </div>
        <p id="pair-code-hint" className="text-muted-foreground text-xs">
          Open VitalSync on the watch and choose Pair. Enter the code it shows here.
        </p>
      </form>

      {active.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="Paired watches">
          {active.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Watch className="text-muted-foreground size-4" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-muted-foreground text-xs">
                  {d.tokenPrefix
                    ? `Seen ${formatAgo(d.lastSeenAt, now)}`
                    : "Waiting for the watch to finish pairing…"}
                </div>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Disconnect ${d.name}`}
                disabled={revoke.isPending}
                onClick={() => {
                  if (confirm(`Disconnect ${d.name}? It will stop sending data until paired again.`))
                    revoke.mutate(d.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
