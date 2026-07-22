"""Seed Cloud SQL with real readings + features (no synthetic history).

Prefer scripts/seed_cloud_sql_real.py (truncates first). This entry point
now also seeds real OpenMeteo/GloFAS only.

Steps:
  1. Start Cloud SQL Auth Proxy
  2. Real OpenMeteo / GloFAS ingest
  3. Historical flood_features backfill
  4. Refresh gauge_hourly materialized view
"""
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
PROXY_PORT = "5433"
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
        [*gcloud_cmd(), "secrets", "versions", "access", "latest",
         f"--secret={name}", f"--project={PROJECT}"],
        text=True,
    ).strip()


def main() -> int:
    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        print(f"Downloading proxy to {proxy}")
        urllib.request.urlretrieve(PROXY_URL, proxy)

    proxy_proc = subprocess.Popen(
        [str(proxy), CONNECTION, f"--port={PROXY_PORT}", "--address=127.0.0.1", "--gcloud-auth"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        time.sleep(4)
        if proxy_proc.poll() is not None:
            print(proxy_proc.stdout.read() if proxy_proc.stdout else "proxy exited")
            return 1

        env = {
            **os.environ,
            "DB_HOST": "127.0.0.1",
            "DB_PORT": PROXY_PORT,
            "DB_USER": db_user,
            "DB_PASSWORD": db_password,
            "DB_NAME": db_name,
            "MET_HISTORY_DAYS": os.getenv("MET_HISTORY_DAYS", "92"),
            "GAUGE_HISTORY_DAYS": os.getenv("GAUGE_HISTORY_DAYS", "92"),
            "PYTHONPATH": str(ROOT / "ingest") + os.pathsep + str(ROOT / "flink" / "jobs"),
        }

        steps = [
            ("Real OpenMeteo/GloFAS ingest", [
                sys.executable, str(ROOT / "ingest" / "flood_risk" / "real_data.py"), "--once",
            ]),
            ("Historical flood features", [
                sys.executable, str(ROOT / "flink" / "jobs" / "backfill_features.py"),
            ]),
        ]

        for label, cmd in steps:
            print(f"\n=== {label} ===")
            result = subprocess.run(cmd, env=env, cwd=str(ROOT))
            if result.returncode != 0:
                print(f"FAILED: {label}")
                return result.returncode

        # Refresh materialized view for history charts
        print("\n=== Refresh gauge_hourly ===")
        refresh = subprocess.run(
            [
                "docker", "run", "--rm",
                "-e", f"PGPASSWORD={db_password}",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={db_user} dbname={db_name} sslmode=disable"
                ),
                "-c",
                "REFRESH MATERIALIZED VIEW gauge_hourly; "
                "SELECT "
                "(SELECT count(*) FROM gauge_readings) AS gauge_readings, "
                "(SELECT count(*) FROM met_readings) AS met_readings, "
                "(SELECT count(*) FROM flood_features) AS flood_features;",
            ]
        )
        if refresh.returncode != 0:
            return refresh.returncode

        print("\nCloud SQL data seed complete.")
        return 0
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
