"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

/** A seeded quiz_questions row (see schema.sql / seed_quiz.sql). */
type Question = {
  id: string;
  technique_id: string;
  prompt: string;
  options: string[];
  correct_index: number;
};

const QUIZ_SIZE = 10;

/** Fisher–Yates shuffle on a copy. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Pick up to QUIZ_SIZE questions with distinct techniques from the pool. */
function sample(pool: Question[]): Question[] {
  const seen = new Set<string>();
  const picked: Question[] = [];
  for (const question of shuffle(pool)) {
    if (seen.has(question.technique_id)) continue;
    seen.add(question.technique_id);
    picked.push(question);
    if (picked.length >= QUIZ_SIZE) break;
  }
  return picked;
}

export function QuizSession() {
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pool, setPool] = useState<Question[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      const [{ data: userData }, questionsResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("quiz_questions")
          .select("id, technique_id, prompt, options, correct_index")
          .returns<Question[]>(),
      ]);

      if (ignore) return;

      if (questionsResult.error) {
        setError(questionsResult.error.message);
        setLoading(false);
        return;
      }

      setUserId(userData.user?.id ?? null);
      const fetched = questionsResult.data ?? [];
      setPool(fetched);
      setQuestions(sample(fetched));
      setLoading(false);
    }

    load();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  async function answer(optionIndex: number) {
    const question = questions[index];
    if (!question || answered) return;

    const isCorrect = optionIndex === question.correct_index;
    setSelectedIndex(optionIndex);
    setAnswered(true);
    if (isCorrect) setScore((s) => s + 1);

    // Persist the attempt (RLS scopes it to the user). Don't block the UI on it.
    if (userId) {
      const { error: insertError } = await supabase.from("quiz_attempts").insert({
        user_id: userId,
        question_id: question.id,
        selected_index: optionIndex,
        is_correct: isCorrect,
      });
      if (insertError) setSaveError(insertError.message);
    }
  }

  function next() {
    setIndex((i) => i + 1);
    setSelectedIndex(null);
    setAnswered(false);
    setSaveError(null);
  }

  function restart() {
    setQuestions(sample(pool));
    setIndex(0);
    setSelectedIndex(null);
    setAnswered(false);
    setScore(0);
    setSaveError(null);
  }

  if (loading) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        Loading questions…
      </p>
    );
  }

  if (error) {
    return (
      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load the quiz. {error}
      </p>
    );
  }

  if (questions.length === 0) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        No quiz questions yet. Run <code>seed_quiz.sql</code> in Supabase to
        generate the question bank.
      </p>
    );
  }

  // Finished — show the score.
  if (index >= questions.length) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Quiz complete 🎉</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-lg">
            You scored{" "}
            <span className="font-bold">
              {score} / {questions.length}
            </span>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={restart}>Try again</Button>
            <Button
              nativeButton={false}
              variant="ghost"
              render={<Link href="/profile">Back to profile</Link>}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  const question = questions[index];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Question {index + 1} of {questions.length} · Score {score}
      </p>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl leading-snug">
            {question.prompt}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            {question.options.map((option, i) => {
              let stateClass = "";
              if (answered) {
                if (i === question.correct_index) {
                  stateClass =
                    "border-green-500 bg-green-500/10 text-green-700 hover:bg-green-500/10 dark:text-green-300";
                } else if (i === selectedIndex) {
                  stateClass =
                    "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/10";
                }
              }
              return (
                <Button
                  key={i}
                  variant="outline"
                  size="lg"
                  disabled={answered}
                  className={`h-auto justify-start px-3 py-2 text-left whitespace-normal capitalize disabled:opacity-100 ${stateClass}`}
                  onClick={() => answer(i)}
                >
                  {option}
                </Button>
              );
            })}
          </div>

          {answered ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {selectedIndex === question.correct_index
                  ? "Correct!"
                  : "Not quite."}
              </p>
              <Button onClick={next}>
                {index + 1 >= questions.length ? "See results" : "Next"}
              </Button>
            </div>
          ) : null}

          {saveError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Couldn&apos;t save your answer: {saveError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
