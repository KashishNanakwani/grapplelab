import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pricing · GrappleLab",
  description:
    "Free, Pro and Academy plans for spaced-repetition Brazilian Jiu-Jitsu training.",
};

/**
 * `shipped: false` means the feature is on the roadmap but does not exist yet,
 * and renders a "Soon" badge. Keep these honest — several paid features here
 * are unbuilt, and the free 50-technique cap is not enforced anywhere either
 * (`techniques.is_free` in schema.sql is read by no code today).
 */
type Feature = { label: string; shipped: boolean };

type Tier = {
  name: string;
  price: string;
  period: string;
  blurb: string;
  recommended: boolean;
  features: Feature[];
};

/**
 * The tiers from CLAUDE.md. This is the first place the prices are encoded in
 * TypeScript rather than prose, so they can drift from the spec — if one
 * changes, change both.
 */
const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    period: "",
    blurb: "Everything you need to start remembering technique.",
    recommended: false,
    features: [
      { label: "Up to 50 techniques", shipped: false },
      { label: "Daily spaced-repetition reviews", shipped: true },
      { label: "Technique quizzes", shipped: true },
      { label: "Progress dashboard", shipped: true },
      { label: "Memory score", shipped: true },
    ],
  },
  {
    name: "Pro",
    price: "$9",
    period: "/mo",
    blurb: "For the practitioner training several times a week.",
    recommended: true,
    features: [
      { label: "Unlimited techniques", shipped: true },
      { label: "AI coach", shipped: true },
      { label: "Personalized study plans", shipped: true },
      { label: "Competition mode", shipped: false },
      { label: "Advanced analytics", shipped: false },
      { label: "Technique heatmaps", shipped: false },
      { label: "Academy benchmarking", shipped: false },
    ],
  },
  {
    name: "Academy",
    price: "$99",
    period: "/mo",
    blurb: "Run your gym's curriculum and track every student.",
    recommended: false,
    features: [
      { label: "Manage students", shipped: false },
      { label: "Track attendance", shipped: false },
      { label: "Monitor learning progress", shipped: false },
      { label: "Assign technique curricula", shipped: false },
    ],
  },
];

export default function PricingPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6">
      <div className="mb-6 space-y-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
        <p className="text-muted-foreground">
          Start free. Upgrade when you want the AI coach and a plan built around
          your own memory scores.
        </p>
      </div>

      {/* No `sm:` step: three tiers at two columns would strand the third. */}
      <div className="grid gap-3 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <Card
            key={tier.name}
            className={tier.recommended ? "ring-2 ring-primary" : undefined}
          >
            <CardHeader>
              <CardDescription>{tier.name}</CardDescription>
              <CardTitle className="text-2xl">
                {tier.price}
                {tier.period ? (
                  <span className="text-sm font-normal text-muted-foreground">
                    {tier.period}
                  </span>
                ) : null}
              </CardTitle>
              {tier.recommended ? (
                <CardAction>
                  <Badge>Recommended</Badge>
                </CardAction>
              ) : null}
            </CardHeader>

            {/* flex-1 so all three footers line up regardless of list length. */}
            <CardContent className="flex-1 space-y-3">
              <p className="text-sm text-muted-foreground">{tier.blurb}</p>
              <ul className="space-y-2">
                {tier.features.map((feature) => (
                  <li
                    key={feature.label}
                    className="flex items-start justify-between gap-2"
                  >
                    <span
                      className={
                        feature.shipped ? undefined : "text-muted-foreground"
                      }
                    >
                      {feature.label}
                    </span>
                    {feature.shipped ? null : (
                      <Badge variant="secondary">Soon</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter>
              {tier.name === "Free" ? (
                <Button
                  nativeButton={false}
                  className="w-full"
                  render={<Link href="/signup">Get started</Link>}
                />
              ) : (
                // No payment integration exists, so this is genuinely inert
                // rather than a link to a checkout that isn't there.
                <Button disabled variant="outline" className="w-full">
                  Coming soon
                </Button>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        GrappleLab is in active development. Billing isn&apos;t live yet, so
        paid plans can&apos;t be purchased, and features marked{" "}
        <span className="font-medium">Soon</span> aren&apos;t built — including
        the 50-technique cap, which isn&apos;t enforced today.
      </p>
    </main>
  );
}
