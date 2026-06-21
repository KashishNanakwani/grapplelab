"""GrappleLab backend — FastAPI skeleton.

Owns the spaced-repetition scheduler and AI logic (added in later weeks).
For now this is just the platform skeleton with a health check.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
