"""Shared Postgres DSN for local TCP and Cloud SQL Unix sockets."""
from __future__ import annotations

import os


def postgres_dsn() -> str:
    host = os.getenv("DB_HOST", "localhost")
    dbname = os.getenv("DB_NAME", "flooddb")
    user = os.getenv("DB_USER", "flood")
    password = os.getenv("DB_PASSWORD", "floodpass")
    # Cloud Run / Cloud SQL Auth: host=/cloudsql/project:region:instance
    if host.startswith("/"):
        return f"host={host} dbname={dbname} user={user} password={password}"
    port = os.getenv("DB_PORT", "5432")
    return f"host={host} port={port} dbname={dbname} user={user} password={password}"
