"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Horizons the backend accepts (it validates 1..28 server-side too). */
const HORIZONS = [
  { label: "This week", days: 7 },
  { label: "Two weeks", days: 14 },
  { label: "This month", days: 28 },
];

type Plan = { text: string; contextUsed: number; days: number };

export function StudyPlanSession() {
  const [supabase] = useState(() => createClient());

  const [days, setDays] = useState(7);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tracks a 403 specifically, so the paywall message can offer a way out.
  // Kept beside submitError rather than storing JSX in state.
  const [gated, setGated] = useState(false);

  async function generate(horizon: number) {
    if (submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setGated(false);
    setPlan(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError("Your session expired — please log in again.");
        return;
      }

      const res = await fetch(`${API_URL}/study-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ days: horizon }),
      });

      if (!res.ok) {
        // The backend distinguishes these, so surface them usefully rather
        // than collapsing everything into one message.
        if (res.status === 403) {
          setSubmitError("Study plans are a Pro feature. Upgrade to unlock them.");
          setGated(true);
        } else if (res.status === 429) {
          setSubmitError("The AI service is rate limited. Try again shortly.");
        } else if (res.status === 503) {
          setSubmitError("The AI features aren't configured on the server yet.");
        } else {
          setSubmitError(`Couldn't build your plan (${res.status}). Try again.`);
        }
        return;
      }

      const data = (await res.json()) as {
        plan: string;
        context_used: number;
        days: number;
      };
      setPlan({ text: data.plan, contextUsed: data.context_used, days: data.days });
    } catch {
      setSubmitError("Network error building your plan. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Generate a plan</CardTitle>
          <CardDescription>
            Study strategy only — for technique mechanics, ask your coach on the
            mat.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {HORIZONS.map((horizon) => (
              <Button
                key={horizon.days}
                variant={days === horizon.days ? "secondary" : "outline"}
                size="sm"
                disabled={submitting}
                onClick={() => setDays(horizon.days)}
              >
                {horizon.label}
              </Button>
            ))}
          </div>

          <Button
            className="w-full"
            disabled={submitting}
            onClick={() => void generate(days)}
          >
            {submitting ? "Building your plan…" : "Build my plan"}
          </Button>

          {submitError ? (
            <div className="space-y-2">
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </p>
              {gated ? (
                <p className="text-sm">
                  <Link
                    href="/pricing"
                    className="font-medium text-foreground underline"
                  >
                    See plans
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {plan ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Your {plan.days}-day plan</CardTitle>
            <CardDescription>
              {plan.contextUsed > 0
                ? `Based on your ${plan.contextUsed} tracked technique${plan.contextUsed === 1 ? "" : "s"}, position mastery and streak.`
                : "You have no tracked techniques yet, so this is a starting plan."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Rendered as plain text, not markdown: zero dependencies and no
                HTML-injection surface from model output. */}
            <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
              {plan.text}
            </div>
            <p className="text-xs text-muted-foreground">
              AI-generated study advice, not technique instruction. It can be
              wrong — your coach on the mat is the authority.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href="/coach">Ask the AI coach</Link>}
        />
        <Button
          nativeButton={false}
          variant="ghost"
          render={<Link href="/profile">Back to profile</Link>}
        />
      </div>
    </div>
  );
}
