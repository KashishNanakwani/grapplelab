"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
type Belt = "white" | "blue" | "purple" | "brown" | "black";

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

// Analytics views (see analytics.sql). numeric columns arrive as strings.
type PositionMastery = {
  positionId: string;
  positionName: string;
  totalTechniques: number;
  techniquesStarted: number;
  techniquesMastered: number;
  avgMemoryScore: number;
};

type BeltProgress = {
  beltLevel: Belt;
  totalTechniques: number;
  techniquesStarted: number;
  techniquesMastered: number;
};

type DailyActivity = {
  activity_date: string;
  reviews: number;
  quiz_attempts: number;
};

type Streak = { currentStreak: number; longestStreak: number };

const STATUS_BADGE: Record<Status, string> = {
  new: "bg-zinc-100 text-zinc-800 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600",
  learning:
    "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  review:
    "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
  mastered:
    "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
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

// Chart line colors — mid-tones that read on both light and dark backgrounds.
const REVIEWS_COLOR = "#3b82f6"; // blue-500
const QUIZ_COLOR = "#f59e0b"; // amber-500

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Bucketed bar color so weak vs strong reads at a glance. */
function scoreColor(score: number): string {
  if (score < 34) return "bg-red-500";
  if (score < 67) return "bg-amber-500";
  return "bg-green-500";
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

function Unavailable() {
  return (
    <p className="text-sm text-muted-foreground">
      Analytics view unavailable — run <code>analytics.sql</code> in Supabase.
    </p>
  );
}

export function ProgressDashboard() {
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [techniques, setTechniques] = useState<StartedTechnique[]>([]);
  const [attempts, setAttempts] = useState<boolean[]>([]);

  // Analytics views are best-effort: null data = section unavailable.
  const [positionMastery, setPositionMastery] = useState<PositionMastery[] | null>(
    null,
  );
  const [beltProgress, setBeltProgress] = useState<BeltProgress[] | null>(null);
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[] | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      const [
        utResult,
        attemptsResult,
        positionResult,
        beltResult,
        activityResult,
        streakResult,
      ] = await Promise.all([
        supabase
          .from("user_techniques")
          .select(
            "technique_id, memory_score, status, next_review_at, techniques(name, kind, positions(name))",
          )
          .returns<UserTechniqueRow[]>(),
        supabase.from("quiz_attempts").select("is_correct").returns<
          { is_correct: boolean }[]
        >(),
        supabase.from("user_position_mastery").select("*").order("sort_order"),
        supabase.from("user_belt_progress").select("*"),
        supabase.from("user_daily_activity").select("*").order("activity_date"),
        supabase.from("user_streak").select("*").maybeSingle(),
      ]);

      if (ignore) return;

      // Core data drives the top-level loading/error/empty states.
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

      // Analytics views — coerce numeric strings to numbers; ignore errors.
      setPositionMastery(
        positionResult.error
          ? null
          : (positionResult.data ?? []).map((r) => ({
              positionId: r.position_id,
              positionName: r.position_name,
              totalTechniques: Number(r.total_techniques),
              techniquesStarted: Number(r.techniques_started),
              techniquesMastered: Number(r.techniques_mastered),
              avgMemoryScore: Number(r.avg_memory_score),
            })),
      );
      setBeltProgress(
        beltResult.error
          ? null
          : (beltResult.data ?? []).map((r) => ({
              beltLevel: r.belt_level,
              totalTechniques: Number(r.total_techniques),
              techniquesStarted: Number(r.techniques_started),
              techniquesMastered: Number(r.techniques_mastered),
            })),
      );
      setDailyActivity(
        activityResult.error
          ? null
          : (activityResult.data ?? []).map((r) => ({
              activity_date: r.activity_date,
              reviews: Number(r.reviews),
              quiz_attempts: Number(r.quiz_attempts),
            })),
      );
      setStreak(
        streakResult.error || !streakResult.data
          ? null
          : {
              currentStreak: Number(streakResult.data.current_streak),
              longestStreak: Number(streakResult.data.longest_streak),
            },
      );

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

  // A streak comes from reviews OR quizzes, so a quiz-only user has a real
  // streak with zero technique rows. Built before the empty-state early
  // return below so it renders in both branches.
  const streakCards = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Stat
        label="Current streak"
        value={
          streak
            ? `${streak.currentStreak} day${streak.currentStreak === 1 ? "" : "s"}`
            : "—"
        }
      />
      <Stat
        label="Longest streak"
        value={
          streak
            ? `${streak.longestStreak} day${streak.longestStreak === 1 ? "" : "s"}`
            : "—"
        }
      />
    </div>
  );

  if (techniques.length === 0) {
    return (
      <div className="space-y-4">
        {streakCards}
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
      </div>
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
      {/* Streak */}
      {streakCards}

      {/* Summary */}
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

      {/* Quiz stats */}
      <Card>
        <CardHeader>
          <CardTitle>Quiz stats</CardTitle>
          <CardDescription>
            {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"} ·{" "}
            {accuracy === null ? "—" : `${accuracy}%`} accuracy
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Position mastery matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Position mastery</CardTitle>
          <CardDescription>Average memory score per position.</CardDescription>
        </CardHeader>
        <CardContent>
          {positionMastery === null ? (
            <Unavailable />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {positionMastery.map((p) => (
                <div
                  key={p.positionId}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <div className="font-medium">{p.positionName}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.techniquesStarted}/{p.totalTechniques} started ·{" "}
                    {p.techniquesMastered} mastered
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${scoreColor(p.avgMemoryScore)}`}
                        style={{ width: `${p.avgMemoryScore}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm tabular-nums">
                      {p.avgMemoryScore}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Belt progression roadmap */}
      <Card>
        <CardHeader>
          <CardTitle>Belt progression</CardTitle>
          <CardDescription>Techniques mastered toward each belt.</CardDescription>
        </CardHeader>
        <CardContent>
          {beltProgress === null ? (
            <Unavailable />
          ) : (
            <ul className="space-y-3">
              {beltProgress.map((b) => {
                const pct =
                  b.totalTechniques > 0
                    ? Math.round((100 * b.techniquesMastered) / b.totalTechniques)
                    : 0;
                return (
                  <li key={b.beltLevel} className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className={`w-16 shrink-0 justify-center capitalize ${BELT_BADGE[b.beltLevel]}`}
                    >
                      {b.beltLevel}
                    </Badge>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {b.techniquesStarted}/{b.totalTechniques} · {b.techniquesMastered} mastered
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Activity trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Activity (last 90 days)</CardTitle>
          <CardDescription>Reviews and quiz attempts per day.</CardDescription>
        </CardHeader>
        <CardContent>
          {dailyActivity === null ? (
            <Unavailable />
          ) : dailyActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={dailyActivity}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="activity_date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d: string) =>
                    new Date(d).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  minTickGap={24}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                <Tooltip
                  labelFormatter={(d) => new Date(d).toLocaleDateString()}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="reviews"
                  name="Reviews"
                  stroke={REVIEWS_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="quiz_attempts"
                  name="Quiz attempts"
                  stroke={QUIZ_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-technique list */}
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
