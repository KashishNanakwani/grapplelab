"""GrappleLab backend — FastAPI app.

Owns the spaced-repetition scheduler and the AI features. Routes:
`GET /health`, `POST /reviews` (records a review, advances SM-2),
`POST /coach` (AI study coach), `POST /study-plan` (AI training plan).
"""

import logging
from datetime import datetime, timezone
from typing import Optional, Tuple
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field
from supabase import Client

from coach import build_context, build_system_instruction
from config import (
    ALLOW_FREE_TIER_COACH,
    FRONTEND_ORIGINS,
    GEMINI_API_KEY,
    GEMINI_MODEL,
)
from gemini import GeminiError, ask_gemini
from spaced_repetition import learning_status, memory_score, review
from study_plan import (
    build_plan_context,
    build_plan_prompt,
    build_plan_system_instruction,
)
from supabase_client import get_current_user

# uvicorn's logging config attaches handlers to the `uvicorn*` loggers only —
# it leaves the root logger without one, so our records would fall through to
# Python's unformatted last-resort handler and be easy to miss. basicConfig is
# a no-op when root already has handlers, and `uvicorn` sets propagate=False,
# so this cannot duplicate uvicorn's own output.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s: %(message)s",
)

logger = logging.getLogger("grapplelab")

app = FastAPI(title="GrappleLab API", version="0.1.0")

# Printed once at import. `--reload` watches *.py and not .env, so this is how
# you can tell from the terminal whether a restart actually picked up the env
# file. Boolean only — the key itself is never logged.
logger.info(
    "startup: AI model=%s, GEMINI_API_KEY set=%s",
    GEMINI_MODEL,
    bool(GEMINI_API_KEY),
)

# During local dev the Next.js frontend runs on localhost:3000 (and the
# equivalent 127.0.0.1:3000, which browsers treat as a separate origin).
# Override in production via the FRONTEND_ORIGIN environment variable.
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe used by Render and local smoke tests."""
    return {"status": "ok"}


class ReviewRequest(BaseModel):
    """A user rating their recall of one technique."""

    technique_id: UUID
    quality: int = Field(ge=0, le=5, description="Recall quality 0-5 (SM-2).")


class ReviewResponse(BaseModel):
    """The updated per-technique SM-2 state after a review."""

    ease_factor: float
    interval_days: int
    repetitions: int
    next_review_at: datetime
    memory_score: int
    status: str


# SM-2 starting state for a technique the user has never reviewed (schema defaults).
_DEFAULT_EASE = 2.5
_DEFAULT_INTERVAL = 0
_DEFAULT_REPETITIONS = 0


@app.post("/reviews", response_model=ReviewResponse)
def create_review(
    body: ReviewRequest,
    ctx: Tuple[Client, str] = Depends(get_current_user),
) -> ReviewResponse:
    """Record a spaced-repetition review and advance the user's SM-2 state.

    Loads the caller's `user_techniques` row (creating one on first review),
    runs the SM-2 `review()` function, persists the new state plus a derived
    memory score / status, and appends a `review_logs` audit row. All DB access
    runs as the caller so RLS enforces ownership.
    """
    supabase, user_id = ctx
    technique_id = str(body.technique_id)

    try:
        existing = (
            supabase.table("user_techniques")
            .select("ease_factor, interval_days, repetitions")
            .eq("user_id", user_id)
            .eq("technique_id", technique_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            row = existing.data[0]
            prev_ease = float(row["ease_factor"])
            prev_interval = int(row["interval_days"])
            repetitions = int(row["repetitions"])
        else:
            prev_ease = _DEFAULT_EASE
            prev_interval = _DEFAULT_INTERVAL
            repetitions = _DEFAULT_REPETITIONS

        # Reuse a single `now` so last_reviewed_at and next_review_at agree.
        now = datetime.now(timezone.utc)
        state = review(prev_ease, prev_interval, repetitions, body.quality, now=now)

        new_ease = round(state.ease_factor, 2)
        score = memory_score(state.ease_factor, state.repetitions, state.interval_days)
        status_value = learning_status(state.repetitions, state.interval_days)

        supabase.table("user_techniques").upsert(
            {
                "user_id": user_id,
                "technique_id": technique_id,
                "ease_factor": new_ease,
                "interval_days": state.interval_days,
                "repetitions": state.repetitions,
                "next_review_at": state.next_review_at.isoformat(),
                "last_reviewed_at": now.isoformat(),
                "memory_score": score,
                "status": status_value,
            },
            on_conflict="user_id,technique_id",
        ).execute()

        supabase.table("review_logs").insert(
            {
                "user_id": user_id,
                "technique_id": technique_id,
                "reviewed_at": now.isoformat(),
                "quality": body.quality,
                "prev_interval": prev_interval,
                "new_interval": state.interval_days,
                "prev_ease": round(prev_ease, 2),
                "new_ease": new_ease,
            }
        ).execute()
    except APIError as exc:
        # e.g. unknown technique_id (FK violation) or an RLS rejection.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)

    return ReviewResponse(
        ease_factor=new_ease,
        interval_days=state.interval_days,
        repetitions=state.repetitions,
        next_review_at=state.next_review_at,
        memory_score=score,
        status=status_value,
    )


# --- Shared AI-feature plumbing --------------------------------------------

# Tiers that include the AI features (see the freemium tiers in CLAUDE.md).
_AI_TIERS = ("pro", "academy")

# Weakest-first, so a user with a large library still gets their problem areas.
_CONTEXT_LIMIT = 20

# The technique columns both AI features need.
_TECHNIQUE_SELECT = (
    "memory_score, status, repetitions, ease_factor, "
    "techniques(name, kind, belt_level, positions(name))"
)


def _require_ai_access(supabase: Client, user_id: str) -> None:
    """Raise unless the AI features are configured and the caller may use them.

    Shared by /coach and /study-plan so the gate cannot drift between them.
    """
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY is not set; refusing to call Gemini")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI features are not configured on this server.",
        )

    profile = (
        supabase.table("profiles").select("tier").eq("id", user_id).limit(1).execute()
    )
    tier = (profile.data[0].get("tier") if profile.data else None) or "free"

    if tier not in _AI_TIERS and not ALLOW_FREE_TIER_COACH:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This is a Pro feature. Upgrade to unlock it.",
        )


def _weakest_techniques(supabase: Client, user_id: str) -> list[dict]:
    """The caller's weakest techniques, RLS-scoped, weakest first."""
    rows = (
        supabase.table("user_techniques")
        .select(_TECHNIQUE_SELECT)
        .eq("user_id", user_id)
        .order("memory_score")
        .limit(_CONTEXT_LIMIT)
        .execute()
    )
    return rows.data or []


def _gemini_http_exception(exc: GeminiError) -> HTTPException:
    """Map a GeminiError onto the response the client should see.

    `gemini.py` has already logged the traceback and Gemini's own error body;
    callers log again so no branch can be the silent one.
    """
    if exc.status == status.HTTP_429_TOO_MANY_REQUESTS:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="The AI service is rate limited right now. Try again shortly.",
        )
    if exc.status is not None:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"The AI service rejected the request (Gemini {exc.status}). "
                "See the server log for details."
            ),
        )
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The AI service could not answer: {exc.detail}",
    )


# --- /coach ----------------------------------------------------------------


class CoachRequest(BaseModel):
    """A question for the AI study coach."""

    question: str = Field(
        min_length=1, max_length=1000, description="The user's question."
    )


class CoachResponse(BaseModel):
    """The coach's answer, plus how much of the user's data informed it."""

    answer: str
    context_used: int = Field(
        description="How many of the user's technique rows were sent as context."
    )


@app.post("/coach", response_model=CoachResponse)
def ask_coach(
    body: CoachRequest,
    ctx: Tuple[Client, str] = Depends(get_current_user),
) -> CoachResponse:
    """Answer a study question using the caller's own progress as context.

    Every failure path logs before it raises. A 502 from this endpoint should
    always have a corresponding traceback in the server log.
    """
    supabase, user_id = ctx

    try:
        _require_ai_access(supabase, user_id)
        context_rows = _weakest_techniques(supabase, user_id)
    except APIError as exc:
        logger.error("coach: Supabase rejected the context query: %s", exc.message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    except HTTPException:
        # Our own 403/503 — deliberate responses, not failures to report.
        raise
    except Exception as exc:
        logger.exception(
            "coach: unexpected failure building context (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The coach failed before calling Gemini ({type(exc).__name__}).",
        )

    context = build_context(context_rows)
    logger.info("coach: built context from %s technique rows", len(context_rows))

    try:
        answer = ask_gemini(
            f"{context}\n\nThe user asks: {body.question}",
            build_system_instruction(),
        )
    except GeminiError as exc:
        logger.error("coach: GeminiError (status=%s): %s", exc.status, exc.detail)
        raise _gemini_http_exception(exc)
    except httpx.HTTPError as exc:
        logger.exception(
            "coach: uncaught httpx error reaching Gemini (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI service is unreachable ({type(exc).__name__}).",
        )
    except Exception as exc:
        logger.exception("coach: unexpected failure (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The coach failed unexpectedly ({type(exc).__name__}).",
        )

    logger.info("coach: answered (%s chars)", len(answer))
    return CoachResponse(answer=answer, context_used=len(context_rows))


# --- /study-plan -----------------------------------------------------------


class StudyPlanRequest(BaseModel):
    """A request for a training plan covering the next `days` days."""

    days: int = Field(
        default=7, ge=1, le=28, description="How many days the plan should cover."
    )


class StudyPlanResponse(BaseModel):
    """The generated plan, plus how much of the user's data informed it."""

    plan: str
    context_used: int = Field(
        description="How many of the user's technique rows were sent as context."
    )
    days: int


# A plan is longer than a coach answer, so it gets more room.
_PLAN_MAX_OUTPUT_TOKENS = 1200


@app.post("/study-plan", response_model=StudyPlanResponse)
def create_study_plan(
    body: StudyPlanRequest,
    ctx: Tuple[Client, str] = Depends(get_current_user),
) -> StudyPlanResponse:
    """Generate a personalised training plan from the caller's own data.

    Uses the same auth, tier gate, transport and error taxonomy as /coach.
    Context adds position mastery and streak, which a weekly plan needs and a
    single question does not. Reads only `security_invoker` views, never
    `user_dashboard_summary`.
    """
    supabase, user_id = ctx

    try:
        _require_ai_access(supabase, user_id)
        technique_rows = _weakest_techniques(supabase, user_id)

        # Both are security_invoker views, so RLS scopes them to the caller.
        positions = supabase.table("user_position_mastery").select("*").execute()
        position_rows = positions.data or []

        streak_result = supabase.table("user_streak").select("*").limit(1).execute()
        streak: Optional[dict] = (
            streak_result.data[0] if streak_result.data else None
        )
    except APIError as exc:
        logger.error("study-plan: Supabase rejected a context query: %s", exc.message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "study-plan: unexpected failure building context (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The planner failed before calling Gemini ({type(exc).__name__}).",
        )

    context = build_plan_context(technique_rows, position_rows, streak)
    logger.info(
        "study-plan: context from %s techniques, %s positions, streak=%s",
        len(technique_rows),
        len(position_rows),
        bool(streak),
    )

    try:
        plan = ask_gemini(
            f"{context}\n\n{build_plan_prompt(body.days)}",
            build_plan_system_instruction(),
            max_output_tokens=_PLAN_MAX_OUTPUT_TOKENS,
        )
    except GeminiError as exc:
        logger.error("study-plan: GeminiError (status=%s): %s", exc.status, exc.detail)
        raise _gemini_http_exception(exc)
    except httpx.HTTPError as exc:
        logger.exception(
            "study-plan: uncaught httpx error reaching Gemini (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI service is unreachable ({type(exc).__name__}).",
        )
    except Exception as exc:
        logger.exception("study-plan: unexpected failure (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The planner failed unexpectedly ({type(exc).__name__}).",
        )

    logger.info("study-plan: generated (%s chars)", len(plan))
    return StudyPlanResponse(
        plan=plan, context_used=len(technique_rows), days=body.days
    )
