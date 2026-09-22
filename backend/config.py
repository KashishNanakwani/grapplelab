"""Environment configuration for the backend, loaded once at import.

Centralises every environment-variable read so load order is explicit rather
than an import side-effect. Import this module before anything that needs a
setting.

Locally the values come from a git-ignored `backend/.env`; on Render they come
from the dashboard. `load_dotenv` never overrides an already-set real
environment variable, so the dashboard always wins in production.

Note on defaults: optional settings use `os.getenv(NAME) or DEFAULT`, not
`os.getenv(NAME, DEFAULT)`. A key present-but-blank in `.env` (e.g.
`GEMINI_MODEL=`) is an empty string, not missing, so the two-argument form
would hand back "" and skip the default.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Resolve `.env` next to this file so the app starts from any working
# directory, not only from inside `backend/`.
load_dotenv(Path(__file__).with_name(".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

# Browsers treat `localhost` and `127.0.0.1` as distinct origins, so allow both
# by default in dev. Accepts a comma-separated list; production sets a single
# origin via FRONTEND_ORIGIN.
_DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in (os.getenv("FRONTEND_ORIGIN") or _DEFAULT_ORIGINS).split(",")
    if origin.strip()
]

# --- AI coach (Google Gemini) ----------------------------------------------
# Deliberately not validated here: a missing key must not stop the whole app
# from booting, so `POST /coach` checks it and returns 503 instead.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# gemini-1.5-flash and gemini-2.0-flash no longer exist, and gemini-2.5-* is
# restricted to projects that already used it. 3.5-flash-lite is free-tier,
# the fastest/cheapest current model, and one of the two Google recommends
# for new projects — so it has the most rate-limit headroom on a free key.
_DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
GEMINI_MODEL = os.getenv("GEMINI_MODEL") or _DEFAULT_GEMINI_MODEL

# The coach is a `pro` feature per the freemium tiers. This flag lets a
# free-tier row use it locally without editing the database; leave it unset
# in production so the gate is enforced.
ALLOW_FREE_TIER_COACH = (os.getenv("ALLOW_FREE_TIER_COACH") or "").lower() == "true"
