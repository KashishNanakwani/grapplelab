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
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Starters that stay inside what the coach is allowed to answer. */
const SUGGESTIONS = [
  "What should I focus on this week?",
  "Which techniques keep slipping for me?",
  "How should I split my drilling time?",
];

type Answer = { text: string; contextUsed: number };

export function CoachSession() {
  const [supabase] = useState(() => createClient());

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tracks a 403 specifically, so the paywall message can offer a way out.
  // Kept beside submitError rather than storing JSX in state.
  const [gated, setGated] = useState(false);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setGated(false);
    setAnswer(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError("Your session expired — please log in again.");
        return;
      }

      const res = await fetch(`${API_URL}/coach`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok) {
        // The backend distinguishes these, so surface them usefully rather
        // than collapsing everything into one message.
        if (res.status === 403) {
          setSubmitError("The AI coach is a Pro feature. Upgrade to unlock it.");
          setGated(true);
        } else if (res.status === 429) {
          setSubmitError("The coach is rate limited right now. Try again shortly.");
        } else if (res.status === 503) {
          setSubmitError("The AI coach isn't configured on the server yet.");
        } else {
          setSubmitError(`Couldn't reach the coach (${res.status}). Try again.`);
        }
        return;
      }

      const data = (await res.json()) as { answer: string; context_used: number };
      setAnswer({ text: data.answer, contextUsed: data.context_used });
    } catch {
      setSubmitError("Network error reaching the coach. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Ask your coach</CardTitle>
          <CardDescription>
            Study strategy only — for technique mechanics, ask your coach on the
            mat.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What should I work on before my next competition?"
            maxLength={1000}
            disabled={submitting}
          />

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  setQuestion(suggestion);
                  void ask(suggestion);
                }}
              >
                {suggestion}
              </Button>
            ))}
          </div>

          <Button
            className="w-full"
            disabled={submitting || question.trim().length === 0}
            onClick={() => void ask(question)}
          >
            {submitting ? "Thinking…" : "Ask the coach"}
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

      {answer ? (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Your coach says</CardTitle>
            <CardDescription>
              {answer.contextUsed > 0
                ? `Based on your ${answer.contextUsed} tracked technique${answer.contextUsed === 1 ? "" : "s"}.`
                : "You have no tracked techniques yet, so this is general advice."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Rendered as plain text, not markdown: zero dependencies and no
                HTML-injection surface from model output. */}
            <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
              {answer.text}
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
          render={<Link href="/progress">View progress</Link>}
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
