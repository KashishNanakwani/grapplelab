import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { StudyPlanSession } from "./study-plan-session";

export default async function StudyPlanPage() {
  const supabase = await createClient();

  // The proxy already guards this route; re-check as defense in depth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col p-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Study plan</h1>
        <p className="text-muted-foreground">
          A training plan built from your real memory scores, position mastery
          and streak.
        </p>
      </div>

      <StudyPlanSession />
    </main>
  );
}
