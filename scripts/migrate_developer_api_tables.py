"""Ensure Developer API tables exist on Cloud SQL (ggis-flood-watch)."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

PROJECT = "ggis-flood-watch"
REGION = "europe-west1"
INSTANCE = "gfw-postgres"
CONNECTION = f"{PROJECT}:{REGION}:{INSTANCE}"
PROXY_PORT = "5433"
ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "infra" / "timescaledb" / "migrations" / "003_developer_api_keys.sql"
PROXY_URL = (
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/"
    "v2.15.2/cloud-sql-proxy.x64.exe"
)


def gcloud_cmd() -> list[str]:
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = Path.home() / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    if fallback.exists():
        return [str(fallback)]
    raise FileNotFoundError("gcloud not found")


def secret(name: str) -> str:
    return subprocess.check_output(
        [
            *gcloud_cmd(),
            "secrets",
            "versions",
            "access",
            "latest",
            f"--secret={name}",
            f"--project={PROJECT}",
        ],
        text=True,
    ).strip()


def main() -> int:
    if not SQL.exists():
        raise SystemExit(f"Missing {SQL}")

    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        print("Downloading cloud-sql-proxy…")
        urllib.request.urlretrieve(PROXY_URL, proxy)

    proc = subprocess.Popen(
        [str(proxy), CONNECTION, f"--port={PROXY_PORT}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(3)
    env = {
        **dict(**{k: v for k, v in __import__("os").environ.items()}),
        "PGPASSWORD": db_password,
    }
    try:
        sql_text = SQL.read_text(encoding="utf-8")
        print(f"Applying {SQL.name} to Cloud SQL…")
        # Prefer docker psql client (local may not have psql)
        cmd = [
            "docker",
            "run",
            "--rm",
            "--network",
            "host",
            "-e",
            f"PGPASSWORD={db_password}",
            "postgres:16-alpine",
            "psql",
            f"host=host.docker.internal port={PROXY_PORT} user={db_user} dbname={db_name}",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            sql_text,
        ]
        # Windows docker host networking differs — use host gateway via published proxy on localhost
        cmd = [
            "docker",
            "run",
            "--rm",
            "-e",
            f"PGPASSWORD={db_password}",
            "postgres:16-alpine",
            "psql",
            f"host=host.docker.internal port={PROXY_PORT} user={db_user} dbname={db_name} sslmode=disable",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            sql_text,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
        print(result.stdout)
        if result.returncode != 0:
            print(result.stderr)
            # Fallback: apply via local API container against Cloud SQL is hard;
            # tables are also created on API startup via ensure_developer_tables.
            print(
                "Proxy migrate failed — API startup will CREATE TABLE IF NOT EXISTS. "
                "Redeploy gfw-api to apply schema."
            )
            return 1
        print("Developer API tables ready.")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
