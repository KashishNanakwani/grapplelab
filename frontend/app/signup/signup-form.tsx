"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { signup, type AuthState } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PASSWORD_REQUIREMENT,
  validateEmail,
  validatePassword,
} from "@/lib/auth-validation";

const initialState: AuthState = { error: null };

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signup, initialState);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Validate on submit; block the Server Action if anything is invalid so no
  // network call is made for client-catchable errors.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement)
      .value;

    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);

    if (nextEmailError || nextPasswordError) {
      event.preventDefault();
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create your GrappleLab account</CardTitle>
        <CardDescription>
          Start building a memory that sticks on the mats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : null}

        <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              onBlur={(e) => setEmailError(validateEmail(e.currentTarget.value))}
              onChange={() => emailError && setEmailError(null)}
            />
            {emailError ? (
              <p id="email-error" role="alert" className="text-sm text-destructive">
                {emailError}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={
                passwordError ? "password-error" : "password-hint"
              }
              onBlur={(e) =>
                setPasswordError(validatePassword(e.currentTarget.value))
              }
              onChange={() => passwordError && setPasswordError(null)}
            />
            {passwordError ? (
              <p
                id="password-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {passwordError}
              </p>
            ) : (
              <p id="password-hint" className="text-sm text-muted-foreground">
                {PASSWORD_REQUIREMENT}
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating account…" : "Sign up"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        Already have an account?&nbsp;
        <Link href="/login" className="font-medium text-foreground underline">
          Log in
        </Link>
      </CardFooter>
    </Card>
  );
}
