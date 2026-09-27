"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/auth/form-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { signUp } from "@/lib/auth-client";
import { fieldErrors, PASSWORD_MIN, signUpSchema } from "@/lib/validation/auth";

export function SignUpForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Until React hydrates, a native submit would bypass onSubmit; keep the button disabled.
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = signUpSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});

    const { name, email, password } = parsed.data;
    setPending(true);
    const { error } = await signUp.email({
      name,
      email,
      password,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setPending(false);

    if (error) {
      setFormError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
            ? "An account with this email already exists."
            : (error.message ?? "Could not create your account."),
      );
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Start collecting your Garmin health data.</CardDescription>
      </CardHeader>
      <form method="post" action="#" onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <FormField label="Name" name="name" autoComplete="name" error={errors.name} />
          <FormField label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            error={errors.password}
          />
          <FormField
            label="Confirm password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword}
          />
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending || !hydrated}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Create account
          </Button>
          <p className="text-muted-foreground text-sm">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-foreground font-medium underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
