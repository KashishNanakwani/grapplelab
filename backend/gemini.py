"""Google Gemini transport, shared by every AI feature.

This module owns the HTTP call, the error type and the response parsing.
Feature-specific prompt logic lives elsewhere (`coach.py`, `study_plan.py`)
and passes its own system instruction in, so there is exactly one place
where the network, the error taxonomy and the logging are defined.

API surface: `models/*:generateContent`. Google's docs recommend the newer
Interactions API, but `ListModels` for this project advertises only
`generateContent` / `countTokens` / `createCachedContent` /
`batchGenerateContent` per model, so generateContent is what the key can
actually reach.

Every failure path here logs a full traceback before raising, so nothing
that reaches a caller is a mystery in the server log.
"""

import logging
from typing import Optional

import httpx

from config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger("grapplelab.gemini")

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

_REQUEST_TIMEOUT_SECONDS = 30.0

# Caps runaway answers and free-tier token burn. Truncation is detected via
# finishReason rather than returned silently.
_MAX_OUTPUT_TOKENS = 800

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


def parse_answer(payload: dict) -> str:
    """Pull the answer text out of a generateContent response.

    Pure, so the response shapes that would otherwise fail silently are
    testable. generateContent can return HTTP 200 with no usable text at all —
    a safety block on the prompt, or a candidate that stopped before emitting
    parts — so each of those raises rather than collapsing into a blank answer.
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


def build_request_body(
    prompt: str, system_instruction: str, max_output_tokens: int = _MAX_OUTPUT_TOKENS
) -> dict:
    """The generateContent request body. Pure, so its shape is assertable."""
    return {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": max_output_tokens,
        },
    }


def ask_gemini(
    prompt: str,
    system_instruction: str,
    max_output_tokens: int = _MAX_OUTPUT_TOKENS,
) -> str:
    """Send one prompt to Gemini. Raises GeminiError with real detail.

    Never logs the API key or the prompt — the prompt carries the user's
    training data. Only the model, URL, upstream status and Gemini's own error
    text are logged.
    """
    url = f"{GEMINI_BASE_URL}/{GEMINI_MODEL}:generateContent"

    # Logged before the call so "never attempted" and "attempted and failed"
    # are distinguishable. Boolean only — never the key itself.
    logger.info(
        "POST %s (timeout %ss, api_key_present=%s)",
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
            json=build_request_body(prompt, system_instruction, max_output_tokens),
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        # Connection refused, DNS failure, TLS error, timeout — Gemini never
        # replied.
        logger.exception("request failed before any response (%s)", type(exc).__name__)
        raise GeminiError(
            f"Could not reach Gemini: {type(exc).__name__}: {exc}"
        ) from exc
    except Exception as exc:
        logger.exception(
            "unexpected error issuing the request (%s)", type(exc).__name__
        )
        raise GeminiError(
            f"Unexpected error calling Gemini: {type(exc).__name__}: {exc}"
        ) from exc

    logger.info("Gemini responded %s", response.status_code)

    if response.status_code != httpx.codes.OK:
        logger.error(
            "Gemini %s for model %s: %s",
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
            "Gemini 200 but body was not JSON for model %s: %s",
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
            "Gemini 200 with no usable text for model %s: %s",
            GEMINI_MODEL,
            str(payload)[:_ERROR_BODY_CHARS],
        )
        raise
    except Exception as exc:
        logger.exception("could not parse Gemini's response (%s)", type(exc).__name__)
        raise GeminiError(
            f"Could not parse Gemini's response: {type(exc).__name__}: {exc}"
        ) from exc
