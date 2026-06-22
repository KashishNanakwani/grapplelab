"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Initiates Google OAuth from the browser. Supabase redirects to Google and
 * then back through /auth/callback, which exchanges the code for a session.
 */
export function GoogleButton() {
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setLoading(false);
    }
    // On success the browser is redirected to Google, so no further work here.
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={signInWithGoogle}
      disabled={loading}
    >
      {loading ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}
