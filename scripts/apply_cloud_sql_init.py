"""Apply Cloud SQL schema using the Auth Proxy + psql (Docker)."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "ggis-flood-watch"
REGION = "europe-west1"
INSTANCE = "gfw-postgres"
CONNECTION = f"{PROJECT}:{REGION}:{INSTANCE}"
PROXY_PORT = 5433
PROXY_URL = (
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/"
    "v2.15.2/cloud-sql-proxy.x64.exe"
)


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd))
    return subprocess.run(cmd, check=True, **kwargs)


def gcloud_cmd() -> list[str]:
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = Path.home() / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    if fallback.exists():
        return [str(fallback)]
    raise FileNotFoundError("gcloud not found on PATH")


def gcloud_secret(name: str) -> str:
    out = subprocess.check_output(
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
    )
    return out.strip()


def main() -> int:
    sql_path = ROOT / "infra" / "timescaledb" / "init_cloud_sql.sql"
    if not sql_path.exists():
        run([sys.executable, str(ROOT / "scripts" / "make_cloud_sql_init.py")], cwd=ROOT)

    db_user = gcloud_secret("DB_USER")
    db_password = gcloud_secret("DB_PASSWORD")
    db_name = gcloud_secret("DB_NAME")
    print(f"Connecting as {db_user} to database {db_name}")

    # Cloud SQL requires cloudsqlsuperuser (postgres) to create PostGIS
    import secrets as _secrets

    postgres_password = _secrets.token_urlsafe(24)
    run(
        [
            *gcloud_cmd(),
            "sql",
            "users",
            "set-password",
            "postgres",
            f"--instance={INSTANCE}",
            f"--project={PROJECT}",
            f"--password={postgres_password}",
            "--quiet",
        ]
    )

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        print(f"Downloading Cloud SQL Auth Proxy to {proxy}")
        urllib.request.urlretrieve(PROXY_URL, proxy)

    proxy_proc = subprocess.Popen(
        [
            str(proxy),
            CONNECTION,
            f"--port={PROXY_PORT}",
            "--address=127.0.0.1",
            "--gcloud-auth",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        time.sleep(4)
        if proxy_proc.poll() is not None:
            print(proxy_proc.stdout.read() if proxy_proc.stdout else "proxy exited")
            return 1

        def psql(user: str, password: str, args: list[str]) -> int:
            cmd = [
                "docker",
                "run",
                "--rm",
                "-e",
                f"PGPASSWORD={password}",
                "-v",
                f"{sql_path.parent.resolve()}:/sql:ro",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={user} dbname={db_name} sslmode=disable"
                ),
                *args,
            ]
            print("+ docker run postgres:16 psql ...", " ".join(args[:2]))
            return subprocess.run(cmd).returncode

        # Enable PostGIS as postgres
        code = psql(
            "postgres",
            postgres_password,
            ["-v", "ON_ERROR_STOP=1", "-c", "CREATE EXTENSION IF NOT EXISTS postgis;"],
        )
        if code != 0:
            return code

        # Strip extension lines from init (already handled) and apply as app user
        code = psql(
            db_user,
            db_password,
            ["-v", "ON_ERROR_STOP=1", "-f", "/sql/init_cloud_sql.sql"],
        )
        if code != 0:
            return code

        code = psql(
            db_user,
            db_password,
            [
                "-c",
                "SELECT "
                "(SELECT count(*) FROM gauge_stations) AS gauges, "
                "(SELECT count(*) FROM met_stations) AS mets, "
                "(SELECT extname FROM pg_extension WHERE extname='postgis') AS postgis;",
            ],
        )
        if code != 0:
            return code
        print("Database init complete.")
        return 0
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
