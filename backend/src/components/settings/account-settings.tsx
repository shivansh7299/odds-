"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiKeys } from "@/components/settings/api-keys";
import { apiFetch } from "@/lib/api/fetcher";
import { authClient } from "@/lib/auth-client";

export function AccountSettings({
  name,
  email,
  timezone,
}: {
  name: string;
  email: string;
  timezone: string;
}) {
  const router = useRouter();
  const [tz, setTz] = useState(timezone);
  const [password, setPassword] = useState("");
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(timezone) ? all : [timezone, ...all];
  }, [timezone]);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timezone;

  const saveTz = useMutation({
    mutationFn: (timezone: string) =>
      apiFetch("/api/account", { method: "PATCH", body: JSON.stringify({ timezone }) }),
    onSuccess: () => {
      toast.success("Timezone saved. Daily summaries were rebuilt.");
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.deleteUser({ password });
      if (error)
        throw new Error(error.status === 400 || error.status === 401 ? "Wrong password" : error.message);
    },
    onSuccess: () => {
      toast.success("Your account and all data were deleted.");
      router.replace("/");
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            {name} · {email}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Label htmlFor="tz">Timezone</Label>
          <div className="flex flex-wrap gap-2">
            <Select value={tz} onValueChange={(v) => v && setTz(v)}>
              <SelectTrigger id="tz" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => saveTz.mutate(tz)} disabled={tz === timezone || saveTz.isPending}>
              {saveTz.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Days, sleep nights and daily totals follow this timezone.
            {browserTz !== timezone && (
              <>
                {" "}
                This browser is in{" "}
                <button className="underline" onClick={() => setTz(browserTz)}>
                  {browserTz}
                </button>
                .
              </>
            )}
          </p>
        </CardContent>
      </Card>

      <ApiKeys />

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            Download everything VitalSync stores about you as one JSON file. To delete one source&apos;s data,
            use the Sources page.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <a href="/api/account/export" className={buttonVariants({ variant: "outline" })} download>
            <Download aria-hidden /> Export all data
          </a>
        </CardFooter>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently deletes your account, every data source, all health data and paired watches. This
            can&apos;t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && confirm("Delete your account and all of your health data permanently?")) {
                deleteAccount.mutate();
              }
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="delete-password">Confirm with your password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-64"
              />
            </div>
            <Button type="submit" variant="destructive" disabled={!password || deleteAccount.isPending}>
              {deleteAccount.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Trash2 aria-hidden />
              )}
              Delete account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
