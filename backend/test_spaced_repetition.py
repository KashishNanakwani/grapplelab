"""Tests for the SM-2 spaced-repetition engine."""

from datetime import datetime, timedelta, timezone

import pytest

from spaced_repetition import (
    MIN_EASE_FACTOR,
    learning_status,
    memory_score,
    review,
)

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_first_correct_review():
    """A fresh technique recalled well: interval 1 day, first repetition."""
    state = review(ease_factor=2.5, interval_days=0, repetitions=0, quality=5, now=NOW)

    assert state.repetitions == 1
    assert state.interval_days == 1
    assert state.ease_factor > 2.5  # perfect recall bumps ease
    assert state.next_review_at == NOW + timedelta(days=1)


def test_second_correct_review():
    """Second success jumps the interval to the fixed 6 days."""
    state = review(ease_factor=2.5, interval_days=1, repetitions=1, quality=5, now=NOW)

    assert state.repetitions == 2
    assert state.interval_days == 6
    assert state.next_review_at == NOW + timedelta(days=6)


def test_third_correct_review():
    """From the third success on, interval = round(prev_interval * ease_factor)."""
    ease = 2.5
    state = review(ease_factor=ease, interval_days=6, repetitions=2, quality=4, now=NOW)

    assert state.repetitions == 3
    assert state.interval_days == round(6 * ease)  # 15
    assert state.next_review_at == NOW + timedelta(days=state.interval_days)


def test_failed_review_resets():
    """A lapse (quality < 3) resets repetitions and reschedules for tomorrow."""
    state = review(ease_factor=2.5, interval_days=15, repetitions=5, quality=1, now=NOW)

    assert state.repetitions == 0
    assert state.interval_days == 1
    assert state.next_review_at == NOW + timedelta(days=1)


def test_ease_factor_floor():
    """Ease never drops below 1.3, even when the formula would push it lower."""
    # quality=3 yields a delta of -0.14; from the floor it would go to 1.16.
    state = review(ease_factor=1.3, interval_days=6, repetitions=2, quality=3, now=NOW)

    assert state.ease_factor == MIN_EASE_FACTOR


def test_invalid_quality_raises():
    """Quality outside 0..5 is a programming error, not a lapse."""
    with pytest.raises(ValueError):
        review(ease_factor=2.5, interval_days=0, repetitions=0, quality=6, now=NOW)


def test_memory_score_new_technique_is_low():
    """A brand-new / just-lapsed technique scores near the bottom."""
    assert memory_score(ease_factor=2.5, repetitions=0, interval_days=1) < 20


def test_memory_score_mastered_technique_is_high():
    """A long-interval, high-ease, well-repeated technique approaches 100."""
    score = memory_score(ease_factor=2.8, repetitions=8, interval_days=60)
    assert score >= 90


def test_memory_score_always_in_range():
    """Score is clamped to 0..100 even for extreme inputs."""
    assert memory_score(ease_factor=5.0, repetitions=99, interval_days=999) == 100
    assert 0 <= memory_score(ease_factor=1.3, repetitions=0, interval_days=0) <= 100


def test_learning_status_transitions():
    """Status maps SM-2 state to the learning_status enum values."""
    assert learning_status(repetitions=0, interval_days=1) == "learning"  # lapsed/new
    assert learning_status(repetitions=1, interval_days=1) == "learning"
    assert learning_status(repetitions=3, interval_days=15) == "review"
    assert learning_status(repetitions=5, interval_days=30) == "mastered"
