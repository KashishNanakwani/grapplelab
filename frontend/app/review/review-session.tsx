"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Belt = "white" | "blue" | "purple" | "brown" | "black";

/** A flattened flashcard. SM-2 state lives in the backend, never here. */
type ReviewCard = {
  techniqueId: string;
  name: string;
  kind: string;
  beltLevel: Belt;
  positionName: string | null;
};

/** How many not-yet-started techniques to append so new users always have cards. */
const NEW_CARD_LIMIT = 5;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Anki-style labels mapped to the SM-2 recall quality the backend expects.
const RATINGS = [
  { label: "Again", quality: 1, variant: "destructive" as const },
  { label: "Hard", quality: 3, variant: "outline" as const },
  { label: "Good", quality: 4, variant: "secondary" as const },
  { label: "Easy", quality: 5, variant: "default" as const },
];

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

// PostgREST embeds a to-one relation as an object, but coerce arrays defensively.
type PositionEmbed = { name: string };
type TechniqueEmbed = {
  id: string;
  name: string;
  kind: string;
  belt_level: Belt;
  positions: PositionEmbed | PositionEmbed[] | null;
};

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toCard(technique: TechniqueEmbed): ReviewCard {
  return {
    techniqueId: technique.id,
    name: technique.name,
    kind: technique.kind,
    beltLevel: technique.belt_level,
    positionName: firstOf(technique.positions)?.name ?? null,
  };
}

export function ReviewSession() {
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function buildQueue() {
      const now = new Date().toISOString();

      const [dueResult, startedResult, techniquesResult] = await Promise.all([
        // Due cards: owner-scoped by RLS. `<= now` naturally excludes NULLs.
        supabase
          .from("user_techniques")
          .select(
            "technique_id, next_review_at, techniques(id, name, kind, belt_level, positions(name))",
          )
          .lte("next_review_at", now)
          .order("next_review_at")
          .returns<{ techniques: TechniqueEmbed | TechniqueEmbed[] | null }[]>(),
        supabase
          .from("user_techniques")
          .select("technique_id")
          .returns<{ technique_id: string }[]>(),
        supabase
          .from("techniques")
          .select("id, name, kind, belt_level, positions(name)")
          .order("name")
          .returns<TechniqueEmbed[]>(),
      ]);

      const firstError =
        dueResult.error ?? startedResult.error ?? techniquesResult.error;
      if (firstError) {
        if (!ignore) {
          setError(firstError.message);
          setLoading(false);
        }
        return;
      }

      const dueCards: ReviewCard[] = [];
      for (const row of dueResult.data ?? []) {
        const technique = firstOf(row.techniques);
        if (technique) dueCards.push(toCard(technique));
      }

      const startedIds = new Set(
        (startedResult.data ?? []).map((row) => row.technique_id),
      );
      const dueIds = new Set(dueCards.map((card) => card.techniqueId));

      const newCards: ReviewCard[] = [];
      for (const technique of techniquesResult.data ?? []) {
        if (newCards.length >= NEW_CARD_LIMIT) break;
        if (startedIds.has(technique.id) || dueIds.has(technique.id)) continue;
        newCards.push(toCard(technique));
      }

      if (!ignore) {
        setQueue([...dueCards, ...newCards]);
        setLoading(false);
      }
    }

    buildQueue();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  async function rate(quality: number) {
    const card = queue[index];
    if (!card || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError("Your session expired — please log in again.");
        return;
      }

      const res = await fetch(`${API_URL}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ technique_id: card.techniqueId, quality }),
      });

      if (!res.ok) {
        setSubmitError(`Couldn't save your review (${res.status}). Try again.`);
        return;
      }

      // The backend owns all SM-2 math; we just move on to the next card.
      setIndex((i) => i + 1);
      setRevealed(false);
    } catch {
      setSubmitError("Network error saving your review. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Building your review queue…
      </p>
    );
  }

  if (error) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load your review queue. {error}
      </p>
    );
  }

  const card = queue[index];

  if (!card) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>You&apos;re all caught up 🎉</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Nothing left to review right now. Come back when more techniques are
            due.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              render={<Link href="/profile">Back to profile</Link>}
            />
            <Button
              nativeButton={false}
              variant="ghost"
              render={<Link href="/">Home</Link>}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {queue.length - index} card{queue.length - index === 1 ? "" : "s"} left
      </p>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{card.name}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {card.positionName ? (
              <Badge variant="secondary">{card.positionName}</Badge>
            ) : null}
            <Badge variant="outline" className="capitalize">
              {card.kind}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!revealed ? (
            <Button className="w-full" onClick={() => setRevealed(true)}>
              Show answer
            </Button>
          ) : (
            <>
              <div className="space-y-2 rounded-md bg-muted/50 px-3 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Position</span>
                  <span className="font-medium">
                    {card.positionName ?? "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Kind</span>
                  <span className="font-medium capitalize">{card.kind}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Belt level</span>
                  <Badge
                    variant="outline"
                    className={`capitalize ${BELT_BADGE[card.beltLevel]}`}
                  >
                    {card.beltLevel}
                  </Badge>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm text-muted-foreground">
                  How well did you recall it?
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {RATINGS.map((rating) => (
                    <Button
                      key={rating.label}
                      variant={rating.variant}
                      disabled={submitting}
                      onClick={() => rate(rating.quality)}
                    >
                      {rating.label}
                    </Button>
                  ))}
                </div>
              </div>

              {submitError ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
