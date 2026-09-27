"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/auth/form-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { signIn } from "@/lib/auth-client";
import { fieldErrors, safeRedirectPath, signInSchema } from "@/lib/validation/auth";

export function SignInForm() {
  const router = useRouter();
  const next = safeRedirectPath(useSearchParams().get("next"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Until React hydrates, a native submit would bypass onSubmit; keep the button disabled.
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});

    setPending(true);
    const { error } = await signIn.email(parsed.data);
    setPending(false);

    if (error) {
      setFormError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Incorrect email or password.",
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back. Your dashboard is waiting.</CardDescription>
      </CardHeader>
      <form method="post" action="#" onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <FormField label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            error={errors.password}
          />
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending || !hydrated}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Sign in
          </Button>
          <p className="text-muted-foreground text-sm">
            New here?{" "}
            <Link href="/sign-up" className="text-foreground font-medium underline-offset-4 hover:underline">
              Create an account
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
