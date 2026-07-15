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
-- 3. user_daily_activity — one row per day (within the last 90 days) that
--    had any review or quiz activity, for growth/retention trend charts.
-- ---------------------------------------------------------------------
create or replace view user_daily_activity
with (security_invoker = true) as
with reviews as (
  select reviewed_at::date as day, count(*) as review_count
  from review_logs
  where reviewed_at >= current_date - interval '90 days'
  group by 1
),
quizzes as (
  select
    answered_at::date as day,
    count(*)                          as quiz_count,
    count(*) filter (where is_correct) as quiz_correct
  from quiz_attempts
  where answered_at >= current_date - interval '90 days'
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
-- ---------------------------------------------------------------------
create or replace view user_streak
with (security_invoker = true) as
with activity_days as (
  -- UNION dedupes to one row per distinct active day.
  select reviewed_at::date as day from review_logs
  union
  select answered_at::date as day from quiz_attempts
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
)
select
  -- The run ending today or yesterday is the current streak (0 if none).
  coalesce(max(len) filter (where end_day >= current_date - 1), 0) as current_streak,
  coalesce(max(len), 0)                                            as longest_streak
from runs;
