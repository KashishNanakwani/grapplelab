"""Study plan generator — prompt logic for a personalised weekly plan.

Shares the Gemini transport in `gemini.py` and the scope rule in `coach.py`.
The "no technique instruction" constraint is defined once, in
`coach.build_system_instruction`, and extended here rather than restated —
so the CLAUDE.md rule cannot drift between the two features.

Everything in this module is pure: it turns rows into strings. The only I/O
is `gemini.ask_gemini`, called from `main.py`.
"""

from typing import Optional

from coach import build_context, build_system_instruction

# Positions with an average memory score at or below this are called out as
# the weak areas of the curriculum map.
_WEAK_POSITION_SCORE = 50


def _streak_line(streak: Optional[dict]) -> str:
    """One line describing the user's daily-activity streak."""
    if not streak:
        return "Streak: unknown."

    current = streak.get("current_streak") or 0
    longest = streak.get("longest_streak") or 0

    if current == 0:
        return (
            f"Streak: currently 0 days (best ever {longest}). They have "
            "broken their streak and need to restart the habit."
        )
    return f"Streak: {current} day(s) current, {longest} day(s) best ever."


def _position_lines(rows: list[dict]) -> list[str]:
    """Mastery per position, weakest first, as prompt lines."""
    described: list[tuple[int, str]] = []

    for row in rows:
        name = row.get("position_name") or "Unknown position"
        total = row.get("total_techniques") or 0
        started = row.get("techniques_started") or 0
        mastered = row.get("techniques_mastered") or 0
        avg = row.get("avg_memory_score") or 0

        # Positions the user has not touched at all say nothing useful about
        # mastery, so keep them out of the ranking noise.
        if started == 0 and total == 0:
            continue

        flag = " <- weak area" if started > 0 and avg <= _WEAK_POSITION_SCORE else ""
        described.append(
            (
                int(avg),
                f"{name}: {started}/{total} started, {mastered} mastered, "
                f"avg score {int(avg)}/100{flag}",
            )
        )

    described.sort(key=lambda pair: pair[0])
    return [line for _, line in described]


def build_plan_context(
    technique_rows: list[dict],
    position_rows: list[dict],
    streak: Optional[dict],
) -> str:
    """Assemble the full briefing for a study plan.

    Reuses `coach.build_context` for the per-technique section so the
    struggling/never-practised distinction is defined in exactly one place,
    then adds position mastery and streak — the two signals a weekly plan
    needs that a single question does not.

    Contains technique and position names and numbers only. No user id, no
    email, nothing identifying.
    """
    sections = [build_context(technique_rows)]

    position_lines = _position_lines(position_rows)
    if position_lines:
        sections.append(
            "Mastery by position (weakest first):\n"
            + "\n".join(f"- {line}" for line in position_lines)
        )

    sections.append(_streak_line(streak))

    return "\n\n".join(sections)


def build_plan_system_instruction() -> str:
    """The plan's instructions: the coach's scope rule plus an output shape.

    Deliberately built on top of `coach.build_system_instruction()` so the
    "never teach technique" constraint has a single definition.
    """
    return (
        build_system_instruction()
        + "\n\n"
        "For this request you are producing a STUDY PLAN, not answering a "
        "question. Structure the reply with these exact headings, each on "
        "its own line:\n\n"
        "This week\n"
        "Priorities\n"
        "Drilling split\n\n"
        "Under 'This week', list specific techniques from their data to "
        "review, with their current scores. Under 'Priorities', explain in "
        "one or two sentences what matters most and why, referring to their "
        "weakest positions. Under 'Drilling split', suggest roughly how to "
        "divide mat time between weak areas and maintenance, as percentages "
        "or session counts.\n\n"
        "Use only techniques and positions that appear in their data. If they "
        "have no review history, say so plainly and suggest how to start "
        "rather than inventing a plan. Keep the whole plan under 250 words."
    )


def build_plan_prompt(days: int) -> str:
    """The user-turn text asking for a plan of a given length."""
    return (
        f"Create my training plan for the next {days} day(s), based on the "
        "data above."
    )
