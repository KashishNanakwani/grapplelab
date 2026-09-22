"""Tests for the AI coach's pure prompt-building and response-parsing helpers.

Only the pure functions are covered. `ask_gemini` makes a real network call
and the repo has no mocking convention, so it is verified by hand instead.
"""

import pytest

from coach import GeminiError, build_context, build_system_instruction, parse_answer


def _row(name, score, repetitions, status, ease=2.5, position="Closed Guard"):
    """A `user_techniques` row shaped the way PostgREST returns it."""
    return {
        "memory_score": score,
        "status": status,
        "repetitions": repetitions,
        "ease_factor": ease,
        "techniques": {
            "name": name,
            "kind": "submission",
            "belt_level": "white",
            "positions": {"name": position},
        },
    }


def _payload(text, finish_reason="STOP"):
    """A generateContent success response carrying one text part."""
    return {
        "candidates": [
            {
                "content": {"parts": [{"text": text}], "role": "model"},
                "finishReason": finish_reason,
            }
        ]
    }


def test_empty_rows_says_no_history():
    """A user with no techniques gets an explicit 'nothing yet' briefing."""
    context = build_context([])

    assert "not started any techniques" in context


def test_struggling_and_never_practised_are_separated():
    """A low score from failing must not be conflated with a low score from newness."""
    rows = [
        _row("Armbar", score=20, repetitions=4, status="review", ease=1.4),
        _row("Triangle", score=0, repetitions=0, status="new"),
    ]
    context = build_context(rows)

    struggling_section = context.split("Not practised yet")[0]
    assert "Armbar" in struggling_section
    assert "Triangle" not in struggling_section
    assert "Triangle" in context


def test_new_status_with_zero_score_is_not_called_a_weak_area():
    """A brand-new technique scores ~0 but is not a weak area."""
    context = build_context([_row("Kimura", score=0, repetitions=0, status="new")])

    assert "Struggling" not in context
    assert "Not practised yet" in context


def test_strong_technique_listed_as_solid():
    """A high memory score with real reps is reported as solid."""
    context = build_context(
        [_row("Rear Naked Choke", score=90, repetitions=6, status="mastered")]
    )

    assert "Solid" in context
    assert "Rear Naked Choke" in context


def test_embedded_relation_may_be_a_list():
    """PostgREST can return a to-one embed as a single-element list."""
    row = _row("Cross Collar Choke", score=30, repetitions=3, status="review")
    row["techniques"] = [row["techniques"]]
    row["techniques"][0]["positions"] = [row["techniques"][0]["positions"]]

    context = build_context([row])

    assert "Cross Collar Choke" in context
    assert "Closed Guard" in context


def test_context_contains_no_user_identifiers():
    """Only technique data is sent to the model — never who the user is."""
    rows = [_row("Armbar", score=20, repetitions=4, status="review")]
    context = build_context(rows)

    assert "user_id" not in context
    assert "@" not in context  # no email address leaked in


def test_missing_technique_embed_does_not_crash():
    """A row whose join came back empty still produces a usable line."""
    context = build_context(
        [{"memory_score": 10, "status": "review", "repetitions": 2, "techniques": None}]
    )

    assert "Unknown technique" in context


def test_system_instruction_forbids_technique_instruction():
    """The coach must be told not to teach mechanics (CLAUDE.md hard rule)."""
    instruction = build_system_instruction()

    assert "must NOT explain how to perform" in instruction
    assert "coach on the mat" in instruction


def test_parse_answer_reads_the_first_candidate():
    """The answer lives at candidates[0].content.parts[0].text."""
    assert parse_answer(_payload("Drill the armbar.")) == "Drill the armbar."


def test_parse_answer_joins_multiple_parts():
    """A candidate split across parts is concatenated, not truncated."""
    payload = {
        "candidates": [
            {"content": {"parts": [{"text": "Focus on "}, {"text": "the armbar."}]}}
        ]
    }

    assert parse_answer(payload) == "Focus on the armbar."


def test_parse_answer_raises_on_blocked_prompt():
    """A safety block arrives as HTTP 200 and must not read as an empty answer."""
    payload = {"promptFeedback": {"blockReason": "SAFETY"}}

    with pytest.raises(GeminiError):
        parse_answer(payload)


def test_parse_answer_raises_on_no_candidates():
    """An empty candidates list is an error, not a blank answer."""
    with pytest.raises(GeminiError):
        parse_answer({"candidates": []})


def test_parse_answer_raises_when_candidate_has_no_text():
    """A candidate that stopped for SAFETY before emitting text is an error."""
    payload = {"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]}

    with pytest.raises(GeminiError) as excinfo:
        parse_answer(payload)

    assert "SAFETY" in str(excinfo.value)


def test_gemini_error_carries_upstream_status():
    """main.py branches on `.status`, so it must survive construction."""
    error = GeminiError("Gemini returned 400.", status=400)

    assert error.status == 400
    assert error.detail == "Gemini returned 400."
