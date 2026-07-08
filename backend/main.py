"""GrappleLab backend — FastAPI app.

Owns the spaced-repetition scheduler. Exposes a health check and the
`POST /reviews` endpoint that records a review and advances the SM-2 state.
"""

import os
from datetime import datetime, timezone
from typing import Tuple
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field
from supabase import Client

from spaced_repetition import learning_status, memory_score, review
from supabase_client import get_current_user

app = FastAPI(title="GrappleLab API", version="0.1.0")

# During local dev the Next.js frontend runs on localhost:3000.
# Override in production via the FRONTEND_ORIGIN environment variable.
_frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_frontend_origin],
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
