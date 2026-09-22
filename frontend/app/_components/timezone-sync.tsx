"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/** IANA zone names are ASCII words joined by slashes, e.g. "America/New_York". */
const IANA_ZONE = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * Reports the browser's IANA timezone to `profiles.timezone`.
 *
 * Streaks are a per-day concept and the `user_streak` view buckets activity
 * with `at time zone profiles.timezone`. Without this the day boundary is UTC
 * — 5pm PT — which splits a streak in the middle of evening training. Renders
 * nothing, and no-ops when signed out or when the stored value already matches.
 */
export function TimezoneSync() {
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // The view falls back to UTC for any name Postgres doesn't recognise,
      // but don't store junk in the first place.
      if (!zone || zone.length > 64 || !IANA_ZONE.test(zone)) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", user.id)
        .maybeSingle<{ timezone: string }>();

      if (cancelled || !profile || profile.timezone === zone) return;

      // RLS ("own profile") scopes this to the caller's own row.
      await supabase.from("profiles").update({ timezone: zone }).eq("id", user.id);
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return null;
}
