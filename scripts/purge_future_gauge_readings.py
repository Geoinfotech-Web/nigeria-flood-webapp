"""Delete future-dated gauge readings (GloFAS forecast rows) and refresh gauge_hourly.

Cloud SQL:
  python scripts/purge_future_gauge_readings.py

Local Timescale (via docker):
  python scripts/purge_future_gauge_readings.py --local
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PROJECT = "ggis-flood-watch"
REGION = "europe-west1"
INSTANCE = "gfw-postgres"
CONNECTION = f"{PROJECT}:{REGION}:{INSTANCE}"
PROXY_PORT = "5433"
PROXY_URL = (
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/"
    "v2.15.2/cloud-sql-proxy.x64.exe"
)

SQL = """
BEGIN;
SELECT count(*) AS future_readings
FROM gauge_readings
WHERE time > NOW();

DELETE FROM gauge_readings WHERE time > NOW();

-- Cloud SQL uses a plain materialized view; Timescale uses a continuous agg
-- (REFRESH may fail there — ignore and continue).
DO $$
BEGIN
  REFRESH MATERIALIZED VIEW gauge_hourly;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'gauge_hourly refresh skipped: %', SQLERRM;
END $$;

SELECT
  (SELECT count(*) FROM gauge_readings WHERE time > NOW()) AS remaining_future,
  (SELECT max(time) FROM gauge_readings) AS max_reading_time,
  (SELECT max(bucket) FROM gauge_hourly) AS max_hourly_bucket;
COMMIT;
"""


def gcloud_cmd() -> list[str]:
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = (
        Path.home()
        / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    )
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


def run_local() -> int:
    sql_host = Path(tempfile.gettempdir()) / "gfw_purge_future.sql"
    sql_host.write_text(SQL, encoding="utf-8")
    subprocess.check_call(
        ["docker", "cp", str(sql_host), "flood_timescaledb:/tmp/purge_future.sql"]
    )
    return subprocess.call(
        [
            "docker",
            "exec",
            "flood_timescaledb",
            "psql",
            "-U",
            "flood",
            "-d",
            "flooddb",
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            "/tmp/purge_future.sql",
        ]
    )


def run_cloud() -> int:
    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        urllib.request.urlretrieve(PROXY_URL, proxy)

    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-Process cloud-sql-proxy -ErrorAction SilentlyContinue | Stop-Process -Force",
        ],
        check=False,
    )
    time.sleep(2)
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

        sql_host = Path(tempfile.gettempdir()) / "gfw_purge_future.sql"
        sql_host.write_text(SQL, encoding="utf-8")
        print("=== Purge future gauge readings on Cloud SQL ===")
        return subprocess.call(
            [
                "docker",
                "run",
                "--rm",
                "-e",
                f"PGPASSWORD={db_password}",
                "-v",
                f"{sql_host}:/data/purge.sql:ro",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={db_user} dbname={db_name} sslmode=disable"
                ),
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                "/data/purge.sql",
            ]
        )
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--local",
        action="store_true",
        help="Purge against local flood_timescaledb instead of Cloud SQL",
    )
    args = parser.parse_args()
    return run_local() if args.local else run_cloud()


if __name__ == "__main__":
    raise SystemExit(main())
