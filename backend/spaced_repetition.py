"""GrappleLab spaced-repetition engine — the SM-2 algorithm.

The backend owns the memory math (the frontend must never reimplement it).
`review` is a pure function: given a user's current per-technique state and a
recall-quality rating, it returns the updated state. No database, no network,
no clock reads except an injectable `now` for computing the next review date.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

# SM-2 ease factor never drops below this floor, or intervals collapse.
MIN_EASE_FACTOR = 1.3


@dataclass(frozen=True)
class SM2State:
    """Result of a single review — mirrors the SM-2 columns on user_techniques."""

    ease_factor: float
    interval_days: int
    repetitions: int
    next_review_at: datetime


def review(
    ease_factor: float,
    interval_days: int,
    repetitions: int,
    quality: int,
    now: Optional[datetime] = None,
) -> SM2State:
    """Apply one SM-2 review and return the new state.

    `quality` is the user's recall rating 0-5. Ratings below 3 count as a lapse:
    repetitions reset and the technique is scheduled again tomorrow. `now`
    defaults to the current UTC time and is only used to derive `next_review_at`;
    inject a fixed value to keep the function deterministic in tests.
    """
    if not 0 <= quality <= 5:
        raise ValueError(f"quality must be in 0..5, got {quality}")

    if now is None:
        now = datetime.now(timezone.utc)

    if quality < 3:
        # Lapse: relearn from scratch, review again tomorrow.
        new_repetitions = 0
        new_interval = 1
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = round(interval_days * ease_factor)
        new_repetitions = repetitions + 1

    # The ease factor is updated on every review, then clamped to the floor.
    new_ease = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if new_ease < MIN_EASE_FACTOR:
        new_ease = MIN_EASE_FACTOR

    return SM2State(
        ease_factor=new_ease,
        interval_days=new_interval,
        repetitions=new_repetitions,
        next_review_at=now + timedelta(days=new_interval),
    )


# Weights within the "retention" term (interval vs. repetition streak). Tunable.
_SCORE_INTERVAL_WEIGHT = 0.6
_SCORE_REP_WEIGHT = 0.4

# A technique due ~3 weeks out is treated as "mastered".
_MASTERED_INTERVAL_DAYS = 21


def memory_score(ease_factor: float, repetitions: int, interval_days: int) -> int:
    """Friendly 0-100 confidence number derived from the SM-2 state.

    A first-pass heuristic (tunable): demonstrated *retention* grows with the
    scheduling interval (capped at ~30 days) and the streak of successful
    reviews (capped at 5). The ease factor then scales that as a quality
    multiplier — normalized 0 at the 1.3 floor, 1 at the 2.5 default and above —
    so a technique the user keeps failing is discounted. A brand-new or
    just-lapsed technique (no interval, no streak) scores near 0; a
    long-interval, high-ease one approaches 100.
    """
    interval_component = min(1.0, interval_days / 30.0)
    rep_component = min(1.0, repetitions / 5.0)
    retention = (
        _SCORE_INTERVAL_WEIGHT * interval_component
        + _SCORE_REP_WEIGHT * rep_component
    )

    ease_span = 2.5 - MIN_EASE_FACTOR
    ease_multiplier = max(0.0, min(1.0, (ease_factor - MIN_EASE_FACTOR) / ease_span))

    score = 100 * ease_multiplier * retention
    return max(0, min(100, round(score)))


def learning_status(repetitions: int, interval_days: int) -> str:
    """Map SM-2 state to a `learning_status` enum value (see schema.sql).

    Never returns 'new' — that is the pre-review default; a completed review
    always advances the technique to at least 'learning'.
    """
    if repetitions == 0:
        # Brand-new first attempt or a fresh lapse: still being learned.
        return "learning"
    if interval_days >= _MASTERED_INTERVAL_DAYS:
        return "mastered"
    if repetitions >= 3:
        return "review"
    return "learning"
