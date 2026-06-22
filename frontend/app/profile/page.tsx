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
  current_streak: number;
  longest_streak: number;
  last_active_on: string | null;
  created_at: string;
};

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

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

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
              <Field label="Current streak" value={`${profile.current_streak} days`} />
              <Field label="Longest streak" value={`${profile.longest_streak} days`} />
              <Field
                label="Member since"
                value={new Date(profile.created_at).toLocaleDateString()}
              />
            </div>
          )}

          <Button
            nativeButton={false}
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
