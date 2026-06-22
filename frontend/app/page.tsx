import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">GrappleLab</h1>
        <p className="max-w-md text-muted-foreground">
          Spaced repetition for Brazilian Jiu-Jitsu. Learn techniques, quiz
          yourself, and actually remember them.
        </p>
      </div>
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
          render={<Link href="/techniques">Browse techniques</Link>}
        />
        <Button
          nativeButton={false}
          variant="ghost"
          render={<Link href="/profile">My profile</Link>}
        />
      </div>
    </main>
  );
}
