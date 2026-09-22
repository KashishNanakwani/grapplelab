-- =====================================================================
-- GrappleLab — migration: derive streaks, bucket days in the user's timezone
--
-- Run this ONCE in the Supabase SQL editor, then re-run analytics.sql
-- (which is idempotent: every view is `create or replace`).
--
-- schema.sql uses `create table`, so it is not re-runnable against an
-- existing database — hence this separate migration. schema.sql has been
-- updated to match, so a fresh install produces the same shape without
-- needing this file.
--
-- WHY:
--   * profiles.current_streak / longest_streak / last_active_on were never
--     written by any code — they were permanently 0. /profile rendered those
--     zeros while /progress rendered the real numbers from the user_streak
--     view: two sources of truth, one of them dead. The view is now the only
--     source, so they are dropped rather than backfilled.
--   * Streak days were bucketed with `reviewed_at::date`, which renders in
--     the session timezone (UTC for PostgREST). That rolls the day over at
--     17:00 PT — mid evening-training — splitting genuine streaks and
--     letting one session count as two days. profiles.timezone fixes it.
--
-- ORDERING: deploy the frontend change first. /profile read
-- profiles.current_streak until this commit, and step 2 below removes that
-- column.
--
-- Steps 1-2 are safe to re-run (`if not exists` / `if exists`). Step 2 is
-- irreversible, but those columns hold no real data — every row is 0/NULL.
-- =====================================================================


-- 1. Per-user timezone, reported by the browser on load.
--    See frontend/app/_components/timezone-sync.tsx.
alter table profiles
  add column if not exists timezone text not null default 'UTC';


-- 2. Drop the dead denormalized streak columns. Streaks are now derived on
--    read by the user_streak view, which cannot drift or be spoofed.
alter table profiles drop column if exists current_streak;
alter table profiles drop column if exists longest_streak;
alter table profiles drop column if exists last_active_on;


-- 3. The counterpart to review_logs_user_time_idx, which was missing.
--    user_streak and user_daily_activity both scan quiz_attempts by
--    (user_id, answered_at).
create index if not exists quiz_attempts_user_time_idx
  on quiz_attempts (user_id, answered_at);


-- =====================================================================
-- NEXT: re-run analytics.sql to replace user_streak and
-- user_daily_activity with the timezone-aware versions.
-- =====================================================================
