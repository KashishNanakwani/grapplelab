-- =====================================================================
-- GrappleLab — Database Schema (Supabase / PostgreSQL)
-- Week 1 deliverable. Run this in the Supabase SQL Editor.
--
-- Design notes:
--   * Auth is handled by Supabase Auth, which owns the `auth.users` table.
--     We never write to it directly. Instead we keep a `profiles` row per
--     user, auto-created by a trigger on signup.
--   * The keystone table is `user_techniques`: it holds the per-user,
--     per-technique state for the spaced-repetition (SM-2) algorithm.
--   * Row Level Security (RLS) is ON for every table. In Supabase, a table
--     WITHOUT rls policies is invisible to clients — this is the #1 beginner
--     gotcha. Policies below let users touch only their own rows, while
--     curriculum tables (positions, techniques, quizzes) are readable by any
--     signed-in user.
--   * Analytics are mostly DERIVED from review_logs + user_techniques, not
--     stored. One example dashboard view is included at the bottom.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------
create type belt_rank          as enum ('white', 'blue', 'purple', 'brown', 'black');
create type subscription_tier  as enum ('free', 'pro', 'academy');
create type technique_kind     as enum ('submission', 'sweep', 'pass', 'escape', 'takedown', 'control', 'transition');
create type learning_status    as enum ('new', 'learning', 'review', 'mastered');


-- ---------------------------------------------------------------------
-- 1. profiles  — one row per user, linked to auth.users
-- ---------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text unique,
  display_name      text,
  belt              belt_rank          not null default 'white',
  stripes           smallint           not null default 0 check (stripes between 0 and 4),
  tier              subscription_tier  not null default 'free',
  current_streak    integer            not null default 0,   -- Duolingo-style daily streak
  longest_streak    integer            not null default 0,
  last_active_on    date,
  created_at        timestamptz        not null default now()
);


-- ---------------------------------------------------------------------
-- 2. positions  — the foundational positions (curriculum lookup)
--    e.g. Closed Guard, Side Control, Mount, Back Control, Knee-on-Belly
-- ---------------------------------------------------------------------
create table positions (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  sort_order   integer not null default 0
);


-- ---------------------------------------------------------------------
-- 3. techniques  — the technique library
--    `is_free` gates the 50-technique free tier.
-- ---------------------------------------------------------------------
create table techniques (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  position_id   uuid references positions (id) on delete set null,
  kind          technique_kind not null,
  belt_level    belt_rank not null default 'white',   -- earliest belt it's taught at
  description   text,
  video_url     text,
  is_free       boolean not null default false,        -- true = available on free tier
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4. quiz_questions  — retrieval-practice questions tied to a technique
--    `options` is a JSON array of strings; `correct_index` points into it.
-- ---------------------------------------------------------------------
create table quiz_questions (
  id             uuid primary key default gen_random_uuid(),
  technique_id   uuid not null references techniques (id) on delete cascade,
  prompt         text not null,
  options        jsonb not null,            -- e.g. '["Bridge","Shrimp","Grip break","Stand up"]'
  correct_index  smallint not null,
  explanation    text,
  created_at     timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. user_techniques  — *** THE KEYSTONE TABLE ***
--    Per-user, per-technique spaced-repetition state (SM-2 algorithm).
--    One row is created the first time a user adds a technique to learn.
-- ---------------------------------------------------------------------
create table user_techniques (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles (id) on delete cascade,
  technique_id        uuid not null references techniques (id) on delete cascade,

  -- SM-2 spaced-repetition state ------------------------------------
  ease_factor         numeric(4,2)    not null default 2.5,   -- SM-2 "EF", floors at 1.3
  interval_days       integer         not null default 0,     -- days until next review
  repetitions         integer         not null default 0,     -- consecutive successful reviews
  next_review_at      timestamptz,                            -- when this is due again
  last_reviewed_at    timestamptz,

  -- Friendly UI metric + status ------------------------------------
  memory_score        smallint        not null default 0 check (memory_score between 0 and 100),
  status              learning_status not null default 'new',

  -- In-class drilling aggregates -----------------------------------
  total_drills        integer         not null default 0,
  successful_drills   integer         not null default 0,

  created_at          timestamptz     not null default now(),

  unique (user_id, technique_id)        -- a user has at most one state row per technique
);

create index user_techniques_due_idx on user_techniques (user_id, next_review_at);


-- ---------------------------------------------------------------------
-- 6. review_logs  — one row per spaced-repetition review event
--    This is the audit trail the adaptive algorithm + analytics read from.
--    `quality` is the SM-2 0–5 recall rating (think Anki's Again/Hard/Good/Easy).
-- ---------------------------------------------------------------------
create table review_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  technique_id    uuid not null references techniques (id) on delete cascade,
  reviewed_at     timestamptz not null default now(),
  quality         smallint not null check (quality between 0 and 5),
  prev_interval   integer,
  new_interval    integer,
  prev_ease       numeric(4,2),
  new_ease        numeric(4,2)
);

create index review_logs_user_time_idx on review_logs (user_id, reviewed_at);


-- ---------------------------------------------------------------------
-- 7. drill_logs  — "Practice During Class / Record Success Rate"
-- ---------------------------------------------------------------------
create table drill_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  technique_id    uuid not null references techniques (id) on delete cascade,
  attempts        integer not null default 0,
  successes       integer not null default 0,
  notes           text,
  trained_on      date not null default current_date,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 8. quiz_attempts  — one row per answered quiz question
-- ---------------------------------------------------------------------
create table quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  question_id   uuid not null references quiz_questions (id) on delete cascade,
  selected_index smallint not null,
  is_correct    boolean not null,
  answered_at   timestamptz not null default now()
);


-- =====================================================================
-- 9. Auto-create a profile row whenever a new auth user signs up
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- 10. Row Level Security
-- =====================================================================

-- Curriculum tables: readable by any signed-in user, no writes from clients.
alter table positions      enable row level security;
alter table techniques     enable row level security;
alter table quiz_questions enable row level security;

create policy "curriculum readable by authenticated"
  on positions for select to authenticated using (true);
create policy "techniques readable by authenticated"
  on techniques for select to authenticated using (true);
create policy "questions readable by authenticated"
  on quiz_questions for select to authenticated using (true);

-- User-owned tables: a user sees and edits only their own rows.
alter table profiles         enable row level security;
alter table user_techniques  enable row level security;
alter table review_logs      enable row level security;
alter table drill_logs       enable row level security;
alter table quiz_attempts    enable row level security;

create policy "own profile"          on profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "own user_techniques"  on user_techniques
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own review_logs"      on review_logs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own drill_logs"       on drill_logs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own quiz_attempts"    on quiz_attempts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- =====================================================================
-- 11. Example analytics view (the dashboard reads from views like this)
-- =====================================================================
create or replace view user_dashboard_summary as
select
  ut.user_id,
  count(*)                                              as techniques_started,
  count(*) filter (where ut.status = 'mastered')        as techniques_mastered,
  count(*) filter (where ut.next_review_at <= now())    as due_now,
  round(avg(ut.memory_score))                           as avg_memory_score,
  sum(ut.successful_drills)                             as total_successful_drills,
  sum(ut.total_drills)                                  as total_drills
from user_techniques ut
group by ut.user_id;
