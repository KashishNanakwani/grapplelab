"""Environment configuration for the backend, loaded once at import.

Centralises every environment-variable read so load order is explicit rather
than an import side-effect. Import this module before anything that needs a
setting.

Locally the values come from a git-ignored `backend/.env`; on Render they come
from the dashboard. `load_dotenv` never overrides an already-set real
environment variable, so the dashboard always wins in production.
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
    for origin in os.getenv("FRONTEND_ORIGIN", _DEFAULT_ORIGINS).split(",")
    if origin.strip()
]
