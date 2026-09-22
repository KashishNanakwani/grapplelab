-- =====================================================================
-- GrappleLab — Analytics data layer (run AFTER schema.sql, in the Supabase
-- SQL editor)
--
-- Per-user analytics as Postgres views over the existing tables. These feed
-- the progress dashboard's charts (position mastery matrix, belt roadmap,
-- growth/retention trends, streaks).
--
-- SECURITY: every view is declared `with (security_invoker = true)` so the
-- underlying tables' Row Level Security is evaluated as the QUERYING user,
-- not the view owner. That means a logged-in user sees only their own
-- user_techniques / review_logs / quiz_attempts rows — never anyone else's.
-- (The default, security_definer, would run as the owner and bypass RLS.)
-- Because those tables are already RLS-scoped to auth.uid(), the aggregates
-- are inherently single-user: no user_id filter or output column is needed.
-- The curriculum tables (positions, techniques) are readable by all
-- authenticated users, so "total" counts reflect the full library.
--
-- CAVEAT that follows from the above: an RLS-EXEMPT caller (the service_role
-- key, or `postgres` in the SQL editor) is not filtered by auth.uid(), so it
-- silently gets a GLOBAL aggregate across all users rather than an error.
-- These views are only meaningful when queried as an end user. A leaderboard
-- or batch job needs a different, user_id-grouped artifact.
--
-- memory_score and status are read exactly as stored — never recomputed.
-- Idempotent: create or replace view. No changes to existing tables.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. user_position_mastery — one row per position, for the mastery matrix.
--    Every position appears (LEFT JOINs), even with zero progress.
-- ---------------------------------------------------------------------
create or replace view user_position_mastery
with (security_invoker = true) as
select
  p.id                                                   as position_id,
  p.name                                                 as position_name,
  p.sort_order                                           as sort_order,
  count(distinct t.id)                                   as total_techniques,
  count(ut.id)                                           as techniques_started,
  count(*) filter (where ut.status = 'mastered')         as techniques_mastered,
  coalesce(round(avg(ut.memory_score)), 0)               as avg_memory_score
from positions p
left join techniques t       on t.position_id = p.id
left join user_techniques ut on ut.technique_id = t.id
group by p.id, p.name, p.sort_order
order by p.sort_order;


-- ---------------------------------------------------------------------
-- 2. user_belt_progress — one row per belt_level, for the belt roadmap.
--    Every belt appears (driven off the enum), even with zero techniques.
-- ---------------------------------------------------------------------
create or replace view user_belt_progress
with (security_invoker = true) as
select
  belt                                                   as belt_level,
  count(distinct t.id)                                   as total_techniques,
  count(ut.id)                                           as techniques_started,
  count(*) filter (where ut.status = 'mastered')         as techniques_mastered
from unnest(enum_range(null::belt_rank)) as belt
left join techniques t       on t.belt_level = belt
left join user_techniques ut on ut.technique_id = t.id
group by belt
order by belt;


-- ---------------------------------------------------------------------
-- TIMEZONE, shared by the two day-bucketing views below.
--
-- reviewed_at / answered_at are timestamptz. Casting one straight to ::date
-- renders it in the SESSION timezone, which for PostgREST is UTC — so the
-- "day" would roll over at 17:00 PT, i.e. in the middle of evening training.
-- That both splits genuine streaks and lets one session count as two days.
-- Instead we bucket with `at time zone profiles.timezone`, the zone the
-- browser reported (see frontend/app/_components/timezone-sync.tsx).
--
-- RLS limits `profiles` to the caller's own row, so the scalar subquery
-- yields that user's zone. The pg_timezone_names guard makes an unknown or
-- malformed zone fall back to UTC instead of raising, which would otherwise
-- take down the whole dashboard for that user.
--
-- Note this is retroactive: changing the stored timezone re-buckets all
-- history, so a past streak can lengthen or split.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 3. user_daily_activity — one row per day (within the last 90 days) that
--    had any review or quiz activity, for growth/retention trend charts.
--    Must bucket days identically to user_streak, or the activity chart and
--    the streak cards would disagree about which day a session fell on.
-- ---------------------------------------------------------------------
create or replace view user_daily_activity
with (security_invoker = true) as
with settings as (
  select coalesce(
    (select p.timezone from profiles p
      where exists (select 1 from pg_timezone_names n where n.name = p.timezone)
      limit 1),
    'UTC') as zone
),
reviews as (
  select
    (r.reviewed_at at time zone s.zone)::date  as day,
    count(*)                                   as review_count
  from review_logs r cross join settings s
  where r.reviewed_at >= now() - interval '90 days'
  group by 1
),
quizzes as (
  select
    (q.answered_at at time zone s.zone)::date  as day,
    count(*)                                   as quiz_count,
    count(*) filter (where q.is_correct)       as quiz_correct
  from quiz_attempts q cross join settings s
  where q.answered_at >= now() - interval '90 days'
  group by 1
)
select
  coalesce(r.day, q.day)                                 as activity_date,
  coalesce(r.review_count, 0)                            as reviews,
  coalesce(q.quiz_count, 0)                              as quiz_attempts,
  case
    when coalesce(q.quiz_count, 0) > 0
      then round(100.0 * q.quiz_correct / q.quiz_count)
    else null
  end                                                    as quiz_accuracy
from reviews r
full outer join quizzes q on r.day = q.day
order by activity_date;


-- ---------------------------------------------------------------------
-- 4. user_streak — a single row with the current and longest daily streaks,
--    over the distinct calendar days that had any activity (reviews OR
--    quizzes). Classic gaps-and-islands with window functions.
--
--    Days are bucketed in the user's own timezone — see the TIMEZONE note
--    above. Streaks are computed here and NEVER stored on profiles, so this
--    view is the single source of truth: /profile and /progress read the
--    same numbers and cannot drift.
-- ---------------------------------------------------------------------
create or replace view user_streak
with (security_invoker = true) as
with settings as (
  select coalesce(
    (select p.timezone from profiles p
      where exists (select 1 from pg_timezone_names n where n.name = p.timezone)
      limit 1),
    'UTC') as zone
),
activity_days as (
  -- UNION dedupes to one row per distinct active day.
  select (r.reviewed_at at time zone s.zone)::date as day
    from review_logs r cross join settings s
  union
  select (q.answered_at at time zone s.zone)::date as day
    from quiz_attempts q cross join settings s
),
islands as (
  -- Consecutive days share the same `grp`: (day - its row number) is constant
  -- across a run of back-to-back dates.
  select day, (day - (row_number() over (order by day))::int) as grp
  from activity_days
),
runs as (
  select count(*)::int as len, max(day) as end_day
  from islands
  group by grp
),
today as (
  -- The user's local today, not UTC's. Exactly one row, since `settings`
  -- is an ungrouped scalar select.
  select (now() at time zone s.zone)::date as d from settings s
)
-- LEFT JOIN (not CROSS JOIN) so a user with no activity at all still yields
-- one row of zeros rather than an empty result — the frontend reads this
-- with .maybeSingle() and expects a row.
select
  -- The run ending today or yesterday is the current streak (0 if none).
  -- The one-day grace is deliberate: a streak that ended yesterday still
  -- reads as current until today is over, matching Duolingo-style streaks.
  coalesce(max(r.len) filter (where r.end_day >= t.d - 1), 0)      as current_streak,
  coalesce(max(r.len), 0)                                          as longest_streak
from today t
left join runs r on true;
