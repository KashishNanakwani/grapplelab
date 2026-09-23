"""AI coach — the coach's prompt logic.

The Gemini transport, error type and response parsing live in `gemini.py`
and are shared with the study-plan generator. This module only decides what
to say to the model.

Scope is deliberately narrow. CLAUDE.md's hard rule is "build the learning
system, not the lessons — do not fabricate technique instructions", so the
coach advises on *study strategy* and refuses to explain grappling mechanics.
`build_system_instruction` is the single definition of that rule; the study
plan builds on top of it rather than restating it.

`GeminiError` and `parse_answer` are re-exported so existing importers keep
working after the transport moved.
"""

from typing import Any, Optional

from gemini import GeminiError, ask_gemini, parse_answer

__all__ = [
    "GeminiError",
    "ask_gemini",
    "parse_answer",
    "build_context",
    "build_system_instruction",
]

# memory_score is 0-100 (see spaced_repetition.memory_score).
_WEAK_SCORE_MAX = 50
_STRONG_SCORE_MIN = 75


def _first(value: Any) -> Optional[dict]:
    """PostgREST embeds a to-one relation as an object, but can return a list."""
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _describe(row: dict) -> str:
    """One technique as a single compact line for the prompt."""
    technique = _first(row.get("techniques")) or {}
    name = technique.get("name") or "Unknown technique"
    position = (_first(technique.get("positions")) or {}).get("name")
    kind = technique.get("kind")
    belt = technique.get("belt_level")

    facets = [facet for facet in (position, kind, belt) if facet]
    suffix = f" ({', '.join(facets)})" if facets else ""
    return f"{name}{suffix} — memory score {row.get('memory_score', 0)}/100"


def build_context(rows: list[dict]) -> str:
    """Summarise the caller's technique states into a plain-text briefing.

    Rows are `user_techniques` joined to `techniques`. Nothing identifying the
    user is included — only technique names and their learning state.

    The important subtlety: `memory_score` is near 0 both for a technique the
    user keeps failing AND for one they have never practised, so a score
    threshold alone would conflate the two and produce nonsense advice.
    `repetitions` and `status` separate them.
    """
    if not rows:
        return (
            "This user has not started any techniques yet — they have no "
            "review history at all."
        )

    struggling: list[str] = []
    not_started: list[str] = []
    developing: list[str] = []
    solid: list[str] = []

    for row in rows:
        score = row.get("memory_score") or 0
        repetitions = row.get("repetitions") or 0
        status = row.get("status")

        if status == "new" or repetitions == 0:
            not_started.append(_describe(row))
        elif score < _WEAK_SCORE_MAX:
            # Low score despite having been reviewed = genuinely struggling.
            ease = row.get("ease_factor")
            note = f", ease {ease}" if ease is not None else ""
            struggling.append(f"{_describe(row)}{note}")
        elif score >= _STRONG_SCORE_MIN:
            solid.append(_describe(row))
        else:
            developing.append(_describe(row))

    sections = [f"Techniques in progress: {len(rows)}."]

    if struggling:
        sections.append(
            "Struggling (reviewed but keeps lapsing — the real weak areas):\n"
            + "\n".join(f"- {line}" for line in struggling)
        )
    if developing:
        sections.append(
            "Developing:\n" + "\n".join(f"- {line}" for line in developing)
        )
    if solid:
        sections.append("Solid:\n" + "\n".join(f"- {line}" for line in solid))
    if not_started:
        sections.append(
            "Not practised yet (low score only because they are new, NOT "
            "because the user is failing them):\n"
            + "\n".join(f"- {line}" for line in not_started)
        )

    return "\n\n".join(sections)


def build_system_instruction() -> str:
    """The coach's standing instructions. Pure so it can be asserted on.

    Also the single source of the "no technique instruction" rule — the study
    plan generator extends this string rather than restating the constraint.
    """
    return (
        "You are the GrappleLab study coach. GrappleLab is a spaced-repetition "
        "app for Brazilian Jiu-Jitsu; you help users manage their REVIEW "
        "PRACTICE, not their technique execution.\n\n"
        "You may: interpret memory scores, say which techniques to prioritise "
        "and why, suggest how to structure review and drilling time, explain "
        "how spaced repetition and the schedule work, and encourage honest "
        "self-rating.\n\n"
        "You must NOT explain how to perform any technique — no mechanics, no "
        "grip details, no step-by-step instructions, no troubleshooting of "
        "positions. If asked, say plainly that you do not teach technique and "
        "that they should ask their coach on the mat, then redirect to what "
        "their data says they should focus on. Never invent technique names, "
        "positions or rules that are not in the user's data above.\n\n"
        "Be concise and direct: a few short paragraphs or a short list. "
        "Reference the user's actual numbers when they are relevant."
    )
