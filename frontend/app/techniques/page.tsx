import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type Belt = "white" | "blue" | "purple" | "brown" | "black";

type Position = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
};

type Technique = {
  id: string;
  name: string;
  kind: string;
  belt_level: Belt;
  position_id: string | null;
};

const BELT_BADGE: Record<Belt, string> = {
  white:
    "bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600",
  blue: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
  purple:
    "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800",
  brown:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  black: "bg-zinc-900 text-zinc-100 border-zinc-700",
};

function TechniqueRow({ technique }: { technique: Technique }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <span className="font-medium">{technique.name}</span>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary" className="capitalize">
          {technique.kind}
        </Badge>
        <Badge variant="outline" className={`capitalize ${BELT_BADGE[technique.belt_level]}`}>
          {technique.belt_level}
        </Badge>
      </div>
    </li>
  );
}

export default async function TechniquesPage() {
  const supabase = await createClient();

  // The proxy already guards this route; re-check as defense in depth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const [{ data: positions, error: positionsError }, { data: techniques, error: techniquesError }] =
    await Promise.all([
      supabase
        .from("positions")
        .select("id,name,description,sort_order")
        .order("sort_order")
        .returns<Position[]>(),
      supabase
        .from("techniques")
        .select("id,name,kind,belt_level,position_id")
        .order("name")
        .returns<Technique[]>(),
    ]);

  const error = positionsError ?? techniquesError;

  // Group techniques by position_id for quick lookup while rendering.
  const byPosition = new Map<string, Technique[]>();
  for (const technique of techniques ?? []) {
    if (!technique.position_id) continue;
    const group = byPosition.get(technique.position_id) ?? [];
    group.push(technique);
    byPosition.set(technique.position_id, group);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Technique Library</h1>
        <p className="text-muted-foreground">
          Foundational positions and the techniques taught from them.
        </p>
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load the library. {error.message}
        </p>
      ) : !positions || positions.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          No positions yet. Run <code>seed.sql</code> in Supabase to add the foundational
          positions and techniques.
        </p>
      ) : (
        <div className="space-y-4">
          {positions.map((position) => {
            const items = byPosition.get(position.id) ?? [];
            return (
              <Card key={position.id}>
                <CardHeader>
                  <CardTitle>{position.name}</CardTitle>
                  {position.description ? (
                    <CardDescription>{position.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No techniques yet.</p>
                  ) : (
                    <ul>
                      {items.map((technique) => (
                        <TechniqueRow key={technique.id} technique={technique} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
