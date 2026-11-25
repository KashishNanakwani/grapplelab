"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  friendlyAuthError,
  validateEmail,
  validateLoginPassword,
  validatePassword,
} from "@/lib/auth-validation";
import { createClient } from "@/lib/supabase/server";

/**
 * Shape returned to `useActionState` in the client forms. Errors are RETURNED
 * (held in component state), never redirected into the URL — that is what keeps
 * messages friendly and prevents a stale error from surviving navigation.
 */
export type AuthState = { error: string | null };

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

/** Email + password sign-in. First arg is the previous `useActionState` state. */
export async function login(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  // Server-side validation (defense in depth). Login stays lenient on the
  // password — only non-empty — so otherwise-valid credentials are never blocked
  // by the signup-only length rule; Supabase remains the authority.
  const emailError = validateEmail(email);
  if (emailError) return { error: emailError };
  const passwordError = validateLoginPassword(password);
  if (passwordError) return { error: passwordError };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) {
    // Resolves to the generic "Incorrect email or password." — never reveals
    // whether the email exists.
    return { error: friendlyAuthError(error.message) };
  }

  revalidatePath("/", "layout");
  redirect("/profile");
}

/** Email + password sign-up. First arg is the previous `useActionState` state. */
export async function signup(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  const emailError = validateEmail(email);
  if (emailError) return { error: emailError };
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };

  const supabase = await createClient();

  // Build the absolute callback URL for the email-confirmation link.
  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    `https://${headerList.get("host") ?? "localhost:3000"}`;

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return { error: friendlyAuthError(error.message) };
  }

  // When email confirmation is enabled, no session is returned yet — the user
  // must click the link in their inbox first. (Supabase returns an obfuscated
  // response for already-registered emails, preserving enumeration protection.)
  if (!data.session) {
    redirect(
      `/login?message=${encodeURIComponent("Check your email to confirm your account, then sign in.")}`,
    );
  }

  revalidatePath("/", "layout");
  redirect("/profile");
}

/** Sign the current user out. */
export async function signout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
