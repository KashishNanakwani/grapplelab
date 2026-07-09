"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Status = "new" | "learning" | "review" | "mastered";

// PostgREST embeds to-one relations as objects; coerce arrays defensively.
type TechniqueEmbed = {
  name: string;
  kind: string;
  positions: { name: string } | { name: string }[] | null;
};

type UserTechniqueRow = {
  technique_id: string;
  memory_score: number;
  status: Status;
  next_review_at: string | null;
  techniques: TechniqueEmbed | TechniqueEmbed[] | null;
};

type StartedTechnique = {
  techniqueId: string;
  name: string;
  positionName: string | null;
  memoryScore: number;
  status: Status;
  nextReviewAt: string | null;
};

const STATUS_BADGE: Record<Status, string> = {
  new: "bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600",
  learning:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  review:
    "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
  mastered:
    "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
};

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function ProgressDashboard() {
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [techniques, setTechniques] = useState<StartedTechnique[]>([]);
  const [attempts, setAttempts] = useState<boolean[]>([]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      const [utResult, attemptsResult] = await Promise.all([
        supabase
          .from("user_techniques")
          .select(
            "technique_id, memory_score, status, next_review_at, techniques(name, kind, positions(name))",
          )
          .returns<UserTechniqueRow[]>(),
        supabase
          .from("quiz_attempts")
          .select("is_correct")
          .returns<{ is_correct: boolean }[]>(),
      ]);

      if (ignore) return;

      const firstError = utResult.error ?? attemptsResult.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }

      const started: StartedTechnique[] = (utResult.data ?? []).map((row) => {
        const technique = firstOf(row.techniques);
        return {
          techniqueId: row.technique_id,
          name: technique?.name ?? "Unknown technique",
          positionName: firstOf(technique?.positions)?.name ?? null,
          memoryScore: row.memory_score,
          status: row.status,
          nextReviewAt: row.next_review_at,
        };
      });
      // Weakest first so the techniques needing work surface at the top.
      started.sort((a, b) => a.memoryScore - b.memoryScore);

      setTechniques(started);
      setAttempts((attemptsResult.data ?? []).map((a) => a.is_correct));
      setLoading(false);
    }

    load();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  if (loading) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Loading your progress…
      </p>
    );
  }

  if (error) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load your progress. {error}
      </p>
    );
  }

  if (techniques.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No progress yet</CardTitle>
          <CardDescription>
            Start reviewing to see your progress.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            nativeButton={false}
            render={<Link href="/review">Start reviewing</Link>}
          />
        </CardContent>
      </Card>
    );
  }

  const now = Date.now();
  const statusCounts: Record<Status, number> = {
    new: 0,
    learning: 0,
    review: 0,
    mastered: 0,
  };
  let scoreSum = 0;
  let dueNow = 0;
  for (const t of techniques) {
    statusCounts[t.status] += 1;
    scoreSum += t.memoryScore;
    if (t.nextReviewAt && new Date(t.nextReviewAt).getTime() <= now) dueNow += 1;
  }
  const avgScore = Math.round(scoreSum / techniques.length);

  const totalAttempts = attempts.length;
  const correctAttempts = attempts.filter(Boolean).length;
  const accuracy =
    totalAttempts > 0 ? Math.round((100 * correctAttempts) / totalAttempts) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Techniques started" value={techniques.length} />
        <Stat label="Due for review now" value={dueNow} />
        <Stat label="Avg. memory score" value={`${avgScore} / 100`} />
        <Card>
          <CardHeader>
            <CardDescription>By status</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="outline" className={STATUS_BADGE.learning}>
              {statusCounts.learning} learning
            </Badge>
            <Badge variant="outline" className={STATUS_BADGE.review}>
              {statusCounts.review} review
            </Badge>
            <Badge variant="outline" className={STATUS_BADGE.mastered}>
              {statusCounts.mastered} mastered
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quiz stats</CardTitle>
          <CardDescription>
            {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"} ·{" "}
            {accuracy === null ? "—" : `${accuracy}%`} accuracy
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Techniques</CardTitle>
          <CardDescription>Weakest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {techniques.map((t) => (
              <li
                key={t.techniqueId}
                className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium">{t.name}</div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {t.positionName ? (
                      <Badge variant="secondary">{t.positionName}</Badge>
                    ) : null}
                    <Badge variant="outline" className={STATUS_BADGE[t.status]}>
                      {t.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t.nextReviewAt
                        ? `Next: ${new Date(t.nextReviewAt).toLocaleDateString()}`
                        : "Not scheduled"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:w-40">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${t.memoryScore}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums">
                    {t.memoryScore}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
