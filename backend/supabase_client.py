"""Supabase access + auth for the backend.

Builds a per-request Supabase client scoped to the caller's JWT so Postgres
Row Level Security (`auth.uid() = user_id`) enforces ownership for us — the
backend never holds a service-role key. `get_current_user` is a FastAPI
dependency that verifies the bearer token and hands the route a ready-to-use
client plus the authenticated user id.
"""

import os
from typing import Tuple

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

# Fail fast at import time if the deployment is misconfigured.
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required."
    )

_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Tuple[Client, str]:
    """Verify the Supabase JWT and return an RLS-scoped client + user id.

    Raises 401 if the token is missing, invalid, or expired.
    """
    token = credentials.credentials

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    # Route PostgREST calls through the caller's token so RLS applies.
    client.postgrest.auth(token)

    try:
        user_response = client.auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    if user_response is None or user_response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    return client, user_response.user.id
