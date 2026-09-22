"""GrappleLab backend — FastAPI app.

Owns the spaced-repetition scheduler. Exposes a health check, the
`POST /reviews` endpoint that records a review and advances the SM-2 state,
and `POST /coach`, the AI study coach.
"""

import logging
from datetime import datetime, timezone
from typing import Tuple
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field
from supabase import Client

from coach import GeminiError, ask_gemini, build_context
from config import (
    ALLOW_FREE_TIER_COACH,
    FRONTEND_ORIGINS,
    GEMINI_API_KEY,
    GEMINI_MODEL,
)
from spaced_repetition import learning_status, memory_score, review
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
    "startup: coach model=%s, GEMINI_API_KEY set=%s",
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


# Tiers that include the AI coach (see the freemium tiers in CLAUDE.md).
_COACH_TIERS = ("pro", "academy")

# Weakest-first, so a user with a large library still gets their problem areas.
_COACH_CONTEXT_LIMIT = 20


@app.post("/coach", response_model=CoachResponse)
def ask_coach(
    body: CoachRequest,
    ctx: Tuple[Client, str] = Depends(get_current_user),
) -> CoachResponse:
    """Answer a study question using the caller's own progress as context.

    Reads the caller's weakest techniques through the RLS-scoped client, turns
    them into a plain-text briefing, and asks Gemini. The coach is limited to
    study strategy and refuses technique instruction — see `coach.py`.

    Every failure path logs before it raises. A 502 from this endpoint should
    always have a corresponding traceback in the server log.
    """
    supabase, user_id = ctx

    if not GEMINI_API_KEY:
        logger.error("coach: GEMINI_API_KEY is not set; refusing to call Gemini")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI coach is not configured on this server.",
        )

    try:
        profile = (
            supabase.table("profiles")
            .select("tier")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        tier = (profile.data[0].get("tier") if profile.data else None) or "free"

        if tier not in _COACH_TIERS and not ALLOW_FREE_TIER_COACH:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="The AI coach is a Pro feature. Upgrade to unlock it.",
            )

        rows = (
            supabase.table("user_techniques")
            .select(
                "memory_score, status, repetitions, ease_factor, "
                "techniques(name, kind, belt_level, positions(name))"
            )
            .eq("user_id", user_id)
            .order("memory_score")
            .limit(_COACH_CONTEXT_LIMIT)
            .execute()
        )
    except APIError as exc:
        logger.error("coach: Supabase rejected the context query: %s", exc.message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    except HTTPException:
        # Our own 403 — a deliberate response, not a failure to report.
        raise
    except Exception as exc:
        logger.exception(
            "coach: unexpected failure building context (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI coach failed before calling Gemini ({type(exc).__name__}).",
        )

    context_rows = rows.data or []
    context = build_context(context_rows)
    logger.info("coach: built context from %s technique rows", len(context_rows))

    try:
        answer = ask_gemini(body.question, context)
    except GeminiError as exc:
        # `coach.py` has already logged the traceback and Gemini's own error
        # body. Log again here anyway: a branch that returns 502 without
        # logging is exactly the bug this endpoint just had, and this line
        # holds whatever raised the GeminiError, not just coach.py.
        logger.error("coach: GeminiError (status=%s): %s", exc.status, exc.detail)

        # Name the status so the browser message points at the log.
        if exc.status == status.HTTP_429_TOO_MANY_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="The AI coach is rate limited right now. Try again shortly.",
            )
        if exc.status is not None:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"The AI coach rejected the request (Gemini {exc.status}). "
                    "See the server log for details."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI coach could not answer: {exc.detail}",
        )
    except httpx.HTTPError as exc:
        # Safety net: coach.py converts these to GeminiError, so reaching here
        # means something changed. Log it rather than returning a bare 502.
        logger.exception(
            "coach: uncaught httpx error reaching Gemini (%s)", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI coach is unreachable ({type(exc).__name__}).",
        )
    except Exception as exc:
        # Nothing may leave this handler unlogged.
        logger.exception("coach: unexpected failure (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"The AI coach failed unexpectedly ({type(exc).__name__}).",
        )

    logger.info("coach: answered (%s chars)", len(answer))
    return CoachResponse(answer=answer, context_used=len(context_rows))
