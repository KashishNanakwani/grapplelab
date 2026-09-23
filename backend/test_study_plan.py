"""Tests for the study plan generator's pure prompt-building helpers.

Only the pure functions are covered. The Gemini call lives in `gemini.py`,
makes a real network request, and the repo has no mocking convention, so it
is verified by hand instead.
"""

from study_plan import (
    build_plan_context,
    build_plan_prompt,
    build_plan_system_instruction,
)


def _technique(name, score, repetitions, status, position="Closed Guard"):
    """A `user_techniques` row shaped the way PostgREST returns it."""
    return {
        "memory_score": score,
        "status": status,
        "repetitions": repetitions,
        "ease_factor": 2.5,
        "techniques": {
            "name": name,
            "kind": "submission",
            "belt_level": "white",
            "positions": {"name": position},
        },
    }


def _position(name, total, started, mastered, avg):
    """A `user_position_mastery` row."""
    return {
        "position_name": name,
        "total_techniques": total,
        "techniques_started": started,
        "techniques_mastered": mastered,
        "avg_memory_score": avg,
    }


def test_context_includes_techniques_positions_and_streak():
    """All three signals a weekly plan needs end up in one briefing."""
    context = build_plan_context(
        technique_rows=[_technique("Armbar", score=20, repetitions=4, status="review")],
        position_rows=[_position("Closed Guard", 10, 4, 1, 42)],
        streak={"current_streak": 3, "longest_streak": 9},
    )

    assert "Armbar" in context
    assert "Closed Guard" in context
    assert "3 day(s) current" in context


def test_weak_positions_are_flagged_and_sorted_first():
    """The weakest position leads, so the model sees priorities in order."""
    context = build_plan_context(
        technique_rows=[],
        position_rows=[
            _position("Mount", 8, 6, 4, 85),
            _position("Back Control", 6, 3, 0, 30),
        ],
        streak=None,
    )

    mastery = context.split("Mastery by position")[1]
    assert mastery.index("Back Control") < mastery.index("Mount")
    assert "weak area" in mastery


def test_untouched_positions_are_omitted_from_mastery():
    """A position with no techniques at all says nothing about mastery."""
    context = build_plan_context(
        technique_rows=[],
        position_rows=[_position("Knee-on-Belly", 0, 0, 0, 0)],
        streak=None,
    )

    assert "Knee-on-Belly" not in context


def test_broken_streak_is_described_as_broken():
    """A zero current streak should read as 'restart the habit', not '0 days'."""
    context = build_plan_context(
        technique_rows=[],
        position_rows=[],
        streak={"current_streak": 0, "longest_streak": 12},
    )

    assert "broken their streak" in context


def test_missing_streak_degrades_cleanly():
    """A missing streak row must not crash or fabricate a number."""
    context = build_plan_context(technique_rows=[], position_rows=[], streak=None)

    assert "Streak: unknown." in context


def test_empty_everything_still_produces_a_briefing():
    """A brand-new user yields a usable prompt, not an empty string."""
    context = build_plan_context(technique_rows=[], position_rows=[], streak=None)

    assert "not started any techniques" in context


def test_context_contains_no_user_identifiers():
    """Only technique and position data reaches the model."""
    context = build_plan_context(
        technique_rows=[_technique("Armbar", score=20, repetitions=4, status="review")],
        position_rows=[_position("Closed Guard", 10, 4, 1, 42)],
        streak={"current_streak": 3, "longest_streak": 9},
    )

    assert "user_id" not in context
    assert "@" not in context


def test_plan_instruction_inherits_the_no_mechanics_rule():
    """The CLAUDE.md constraint must survive into the plan's instruction."""
    instruction = build_plan_system_instruction()

    assert "must NOT explain how to perform" in instruction
    assert "coach on the mat" in instruction


def test_plan_instruction_requests_the_three_headings():
    """The output shape the frontend expects is actually asked for."""
    instruction = build_plan_system_instruction()

    assert "This week" in instruction
    assert "Priorities" in instruction
    assert "Drilling split" in instruction


def test_plan_prompt_carries_the_day_count():
    """The requested horizon reaches the model."""
    assert "14 day(s)" in build_plan_prompt(days=14)
