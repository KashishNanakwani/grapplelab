"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
}

/** Email + password sign-in. */
export async function login(formData: FormData) {
  const supabase = await createClient();
  const { email, password } = readCredentials(formData);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/profile");
}

/** Email + password sign-up. */
export async function signup(formData: FormData) {
  const supabase = await createClient();
  const { email, password } = readCredentials(formData);

  // Build the absolute callback URL for the email-confirmation link.
  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    `https://${headerList.get("host") ?? "localhost:3000"}`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // When email confirmation is enabled, no session is returned yet — the user
  // must click the link in their inbox first.
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
