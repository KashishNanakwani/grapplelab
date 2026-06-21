# GrappleLab — Project Context for Claude Code

> This file is read automatically by Claude Code at the start of every session.
> Keep it accurate as the project evolves. It is the project's "memory."

## What we're building

GrappleLab is a learning platform for Brazilian Jiu-Jitsu (BJJ). BJJ practitioners
learn dozens of techniques a week but forget most of them, because review is
inconsistent. GrappleLab applies **spaced repetition** and **retrieval practice**
(proven memory science) to BJJ so techniques actually stick.

Mental model: **Duolingo + Anki + a BJJ video library + Chess.com**, for grappling.
- Duolingo → daily streaks, gamified habit loop
- Anki → spaced-repetition memory engine (SM-2 algorithm)
- BJJ content → the technique curriculum
- Chess.com → skill tracking, ratings, analytics

Core user journey:
learn a few techniques → quiz yourself → drill them in class → log success rate →
get an adaptive review schedule → memory score rises → progress along a belt roadmap.

## Tech stack

- **Frontend:** Next.js (App Router) + React + TypeScript + TailwindCSS + shadcn/ui
  - Deployed to **Vercel**
- **Backend:** FastAPI + Python (the spaced-repetition scheduler + AI logic live here)
  - Deployed to **Render**
- **Database & Auth:** **Supabase** (PostgreSQL + Supabase Auth with Google + email login)
- **AI layer (added in Week 3):** OpenAI API *or* Ollama + Llama 3 (local, free) for the
  AI coach, study plans, and technique recommendations.

## Repository structure (monorepo)

```
grapplelab/
  frontend/        # Next.js app  -> Vercel (set root directory = frontend)
  backend/         # FastAPI app  -> Render  (set root directory = backend)
  schema.sql       # Supabase database schema (run in Supabase SQL editor)
  CLAUDE.md        # this file
```

## Domain concepts (get these right)

- **SM-2 spaced repetition:** each user↔technique pair has an `ease_factor` (default 2.5,
  floor 1.3), an `interval_days`, a `repetitions` count, and a `next_review_at`. After each
  review the user rates recall `quality` 0–5; the algorithm updates ease + interval. The
  per-user state lives in the `user_techniques` table; every review is logged in `review_logs`.
- **Memory score:** a friendly 0–100 UI number derived from the SM-2 state. Stored
  denormalized on `user_techniques` for fast dashboard reads.
- **Belt roadmap:** white → blue → purple → brown → black. Techniques have a `belt_level`.
- **Foundational positions** (do not invent others as "core"): Closed Guard, Side Control,
  Mount, Back Control, Knee-on-Belly.
- **High-frequency submissions** to seed first: Armbar, Triangle, Rear Naked Choke, Kimura,
  Cross Collar Choke.
- **Freemium tiers** (gate features by `profiles.tier`): `free` (50 techniques, reviews,
  quizzes, dashboard, memory score), `pro` ($9/mo: unlimited techniques, AI coach, analytics,
  competition mode), `academy` ($99/mo: gym management). Free-tier technique access is gated
  by `techniques.is_free`.

## Hard rule: do not invent BJJ curriculum

Build the *learning system*, not the lessons. Structure content around already-respected
concepts and official **IBJJF** competition rules. When real instructional content or rules
are needed, ask the user to supply or confirm them — do not fabricate technique instructions.

## Coding conventions

- TypeScript strict mode on the frontend; functional components only.
- Keep frontend data access behind a small API client; the FastAPI backend owns the
  spaced-repetition math (do not reimplement SM-2 in the frontend).
- Every Supabase table has Row Level Security enabled — never assume a table is reachable
  without a policy.
- Never hardcode secrets. Use `.env.local` (frontend) and environment variables (backend),
  both git-ignored.
- Prefer small, reviewable diffs. Explain non-obvious choices.

## Current phase

**Week 1 — Platform Foundation.** Goal: a working deployed app where a user can register,
log in, and view a technique library. Build order: scaffold repos → wire Supabase auth →
profiles → technique library (seed the foundational positions + high-frequency submissions)
→ deploy all three services.
