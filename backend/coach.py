"""AI coach — prompt construction and the Google Gemini call.

Split so the interesting logic is pure and testable: `build_context`,
`build_system_instruction` and `parse_answer` take data and return strings,
and `ask_gemini` is the only function that touches the network.

Scope is deliberately narrow. CLAUDE.md's hard rule is "build the learning
system, not the lessons — do not fabricate technique instructions", so the
coach advises on *study strategy* and refuses to explain grappling mechanics.

API surface: `models/*:generateContent`. Google's docs recommend the newer
Interactions API, but `ListModels` for this project advertises only
`generateContent` / `countTokens` / `createCachedContent` /
`batchGenerateContent` per model, so generateContent is what the key can
actually reach.

Every failure path here logs a full traceback before raising, so nothing that
reaches the caller is a mystery in the server log.
"""

import logging
from typing import Any, Optional

import httpx

from config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger("grapplelab.coach")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

_REQUEST_TIMEOUT_SECONDS = 30.0

# Caps runaway answers and free-tier token burn. Truncation is detected via
# finishReason rather than returned silently.
_MAX_OUTPUT_TOKENS = 800

# memory_score is 0-100 (see spaced_repetition.memory_score).
_WEAK_SCORE_MAX = 50
_STRONG_SCORE_MIN = 75

# Bound on how much of Gemini's error body we log, so a huge payload cannot
# flood the terminal.
_ERROR_BODY_CHARS = 500


class GeminiError(Exception):
    """A call to Gemini failed, carrying enough detail to actually debug it.

    `status` is the upstream HTTP status when there was one, else None, which
    covers connection failures, safety blocks and malformed payloads — none of
    which arrive as an HTTP error status.
    """

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.detail = message


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
    """The coach's standing instructions. Pure so it can be asserted on."""
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


def parse_answer(payload: dict) -> str:
    """Pull the answer text out of a generateContent response.

    Pure, so the response shapes that used to fail silently are testable.
    generateContent can return HTTP 200 with no usable text at all — a safety
    block on the prompt, or a candidate that stopped before emitting parts —
    so each of those raises rather than collapsing into a blank answer.
    """
    block_reason = (payload.get("promptFeedback") or {}).get("blockReason")
    if block_reason:
        raise GeminiError(f"Gemini blocked the prompt ({block_reason}).")

    candidates = payload.get("candidates") or []
    if not candidates:
        raise GeminiError("Gemini returned no candidates.")

    candidate = candidates[0]
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()

    if not text:
        finish_reason = candidate.get("finishReason") or "unknown"
        raise GeminiError(f"Gemini returned no text (finishReason {finish_reason}).")

    return text


def _build_request_body(question: str, context: str) -> dict:
    """The generateContent request body. Separated to keep `ask_gemini` short."""
    return {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"{context}\n\nThe user asks: {question}"}],
            }
        ],
        "systemInstruction": {"parts": [{"text": build_system_instruction()}]},
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": _MAX_OUTPUT_TOKENS,
        },
    }


def ask_gemini(question: str, context: str) -> str:
    """Ask Gemini a single question. Raises GeminiError with real detail.

    Never logs the API key or the prompt — the prompt carries the user's
    training data. Only the model, URL, upstream status and Gemini's own error
    text are logged.
    """
    url = f"{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent"

    # Logged before the call so "never attempted" and "attempted and failed"
    # are distinguishable. Boolean only — never the key itself.
    logger.info(
        "coach: POST %s (timeout %ss, api_key_present=%s)",
        url,
        _REQUEST_TIMEOUT_SECONDS,
        bool(GEMINI_API_KEY),
    )

    try:
        response = httpx.post(
            url,
            headers={
                "x-goog-api-key": GEMINI_API_KEY or "",
                "Content-Type": "application/json",
            },
            json=_build_request_body(question, context),
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        # Connection refused, DNS failure, TLS error, timeout — Gemini never
        # replied. This is the path that previously vanished without a trace.
        logger.exception(
            "coach: request failed before any response (%s)", type(exc).__name__
        )
        raise GeminiError(
            f"Could not reach Gemini: {type(exc).__name__}: {exc}"
        ) from exc
    except Exception as exc:
        logger.exception(
            "coach: unexpected error issuing the request (%s)", type(exc).__name__
        )
        raise GeminiError(
            f"Unexpected error calling Gemini: {type(exc).__name__}: {exc}"
        ) from exc

    logger.info("coach: Gemini responded %s", response.status_code)

    if response.status_code != httpx.codes.OK:
        logger.error(
            "coach: Gemini %s for model %s: %s",
            response.status_code,
            GEMINI_MODEL,
            response.text[:_ERROR_BODY_CHARS],
        )
        raise GeminiError(
            f"Gemini returned {response.status_code}.", status=response.status_code
        )

    try:
        payload = response.json()
    except ValueError as exc:
        logger.exception(
            "coach: Gemini 200 but body was not JSON for model %s: %s",
            GEMINI_MODEL,
            response.text[:_ERROR_BODY_CHARS],
        )
        raise GeminiError("Gemini returned a malformed response.", status=200) from exc

    try:
        return parse_answer(payload)
    except GeminiError:
        # 200 with no usable text: log the whole payload, it is small and it
        # is the only record of why the answer was empty.
        logger.error(
            "coach: Gemini 200 with no usable text for model %s: %s",
            GEMINI_MODEL,
            str(payload)[:_ERROR_BODY_CHARS],
        )
        raise
    except Exception as exc:
        logger.exception(
            "coach: could not parse Gemini's response (%s)", type(exc).__name__
        )
        raise GeminiError(
            f"Could not parse Gemini's response: {type(exc).__name__}: {exc}"
        ) from exc
