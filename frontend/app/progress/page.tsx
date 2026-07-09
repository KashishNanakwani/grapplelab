import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ProgressDashboard } from "./progress-dashboard";

export default async function ProgressPage() {
  const supabase = await createClient();

  // The proxy already guards this route; re-check as defense in depth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Progress</h1>
        <p className="text-muted-foreground">
          Your mastery across the techniques you&apos;ve started reviewing.
        </p>
      </div>

      <ProgressDashboard />
    </main>
  );
}
