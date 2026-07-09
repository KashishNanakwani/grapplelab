import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ReviewSession } from "./review-session";

export default async function ReviewPage() {
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
        <h1 className="text-3xl font-bold tracking-tight">Review</h1>
        <p className="text-muted-foreground">
          Rate how well you recalled each technique. Your review schedule adapts
          automatically.
        </p>
      </div>

      <ReviewSession />
    </main>
  );
}
