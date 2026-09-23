import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Only steps the app actually performs. Keep this honest: the landing page
 * must not describe behaviour that isn't built, same rule as /pricing.
 */
const STEPS = [
  {
    title: "Learn",
    body: "Add the techniques you're drilling to your own library.",
  },
  {
    title: "Review",
    body: "Each one comes back on an SM-2 schedule, timed to just before you'd forget it.",
  },
  {
    title: "Track",
    body: "A memory score per technique, plus streaks and progress over time.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 p-6">
      <section className="space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Remember the techniques you learn
        </h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          BJJ practitioners pick up dozens of techniques a week and forget most
          of them. GrappleLab uses spaced repetition to bring each one back
          just before it slips.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            nativeButton={false}
            render={<Link href="/signup">Get started</Link>}
          />
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/login">Log in</Link>}
          />
          <Button
            nativeButton={false}
            variant="ghost"
            render={<Link href="/pricing">See pricing</Link>}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-center text-sm font-medium text-muted-foreground">
          How it works
        </h2>

        {/* Three short cards survive three-across at 640px, so this uses the
            sm: step rather than /pricing's lg:. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step) => (
            <Card key={step.title}>
              <CardHeader>
                <CardTitle>{step.title}</CardTitle>
                <CardDescription>{step.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Spaced-repetition reviews, quizzes and progress tracking are free.
          The AI coach and study plans are{" "}
          <Link
            href="/pricing"
            className="font-medium text-foreground underline"
          >
            Pro features
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
