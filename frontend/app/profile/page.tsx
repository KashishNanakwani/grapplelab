import Link from "next/link";
import { redirect } from "next/navigation";

import { signout } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

/** Shape of a row in the `profiles` table (see schema.sql). */
type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  belt: "white" | "blue" | "purple" | "brown" | "black";
  stripes: number;
  tier: "free" | "pro" | "academy";
  timezone: string;
  created_at: string;
};

/**
 * The single row from the `user_streak` view (see analytics.sql). Streaks are
 * derived from review + quiz activity, never stored on `profiles`, so this
 * page and /progress cannot disagree.
 */
type Streak = { current_streak: number; longest_streak: number };

function days(n: number) {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const supabase = await createClient();

  // The proxy already guards this route, but re-check here as defense in depth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const [{ data: profile, error }, { data: streak }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    // RLS scopes the view to this user; it always returns exactly one row.
    supabase.from("user_streak").select("*").maybeSingle<Streak>(),
  ]);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {profile?.display_name ?? profile?.username ?? "Your profile"}
          </CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error || !profile ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Couldn&apos;t load your profile row.{" "}
              {error?.message ?? "No profile found for this user."}
            </p>
          ) : (
            <div>
              <Field
                label="Belt"
                value={`${profile.belt}${profile.stripes ? ` · ${profile.stripes} stripe${profile.stripes > 1 ? "s" : ""}` : ""}`}
              />
              <Field label="Tier" value={profile.tier} />
              <Field
                label="Current streak"
                value={streak ? days(streak.current_streak) : "—"}
              />
              <Field
                label="Longest streak"
                value={streak ? days(streak.longest_streak) : "—"}
              />
              <Field
                label="Member since"
                value={new Date(profile.created_at).toLocaleDateString()}
              />
            </div>
          )}

          <Button
            nativeButton={false}
            className="w-full"
            render={<Link href="/review">Start review</Link>}
          />

          <Button
            nativeButton={false}
            variant="outline"
            className="w-full"
            render={<Link href="/quiz">Take a quiz</Link>}
          />

          <Button
            nativeButton={false}
            variant="outline"
            className="w-full"
            render={<Link href="/progress">View progress</Link>}
          />

          <Button
            nativeButton={false}
            variant="outline"
            className="w-full"
            render={<Link href="/coach">Ask the AI coach</Link>}
          />

          <Button
            nativeButton={false}
            variant="outline"
            className="w-full"
            render={<Link href="/study-plan">Build a study plan</Link>}
          />

          <Button
            nativeButton={false}
            variant="outline"
            className="w-full"
            render={<Link href="/techniques">Browse techniques</Link>}
          />

          <form action={signout}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
