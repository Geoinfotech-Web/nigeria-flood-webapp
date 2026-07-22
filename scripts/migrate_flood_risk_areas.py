"""Copy inundation + urban flash polygons from local TimescaleDB → Cloud SQL."""
from __future__ import annotations

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
    dump = Path(tempfile.gettempdir()) / "gfw_flood_risk_areas.sql"
    print("=== Dump local non-synthetic flood_risk_areas ===")
    # Export INSERT statements for real vector layers only
    sql_out = subprocess.check_output(
        [
            "docker", "exec", "flood_timescaledb",
            "psql", "-U", "flood", "-d", "flooddb", "-At", "-c",
            """
            COPY (
              SELECT name, admin_level, state,
                     ST_AsEWKT(geom), risk_score, risk_tier, source,
                     valid_from, valid_to
              FROM flood_risk_areas
              WHERE source IN ('sar_dem_inundation', 'urban_flash_flood')
            ) TO STDOUT WITH (FORMAT csv, FORCE_QUOTE *)
            """,
        ],
        text=True,
    )
    dump.write_text(sql_out, encoding="utf-8")
    lines = [ln for ln in sql_out.splitlines() if ln.strip()]
    print(f"Exported {len(lines)} rows -> {dump}")
    if not lines:
        print("Nothing to migrate")
        return 1

    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        urllib.request.urlretrieve(PROXY_URL, proxy)

    GetProcess = None
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-Process cloud-sql-proxy -ErrorAction SilentlyContinue | Stop-Process -Force"],
        check=False,
    )
    time.sleep(2)
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

        # Load via temp CSV into docker postgres client
        load_sql = Path(tempfile.gettempdir()) / "gfw_load_risk_areas.sql"
        load_sql.write_text(
            """
BEGIN;
DELETE FROM flood_risk_areas
 WHERE source IN ('sar_dem_inundation', 'urban_flash_flood');

CREATE TEMP TABLE _risk_import (
  name text,
  admin_level text,
  state text,
  geom_ewkt text,
  risk_score double precision,
  risk_tier text,
  source text,
  valid_from date,
  valid_to date
);

\\copy _risk_import FROM '/data/flood_risk_areas.csv' WITH (FORMAT csv)

INSERT INTO flood_risk_areas
  (name, admin_level, state, geom, risk_score, risk_tier, source, valid_from, valid_to)
SELECT
  name, admin_level, state,
  ST_Multi(ST_GeomFromEWKT(geom_ewkt))::geometry(MultiPolygon,4326),
  risk_score, risk_tier, source, valid_from, valid_to
FROM _risk_import;

SELECT source, risk_tier, count(*)
FROM flood_risk_areas
WHERE source IN ('sar_dem_inundation', 'urban_flash_flood')
GROUP BY 1,2
ORDER BY 1,2;
COMMIT;
""",
            encoding="utf-8",
        )

        csv_host = Path(tempfile.gettempdir()) / "flood_risk_areas.csv"
        csv_host.write_text(sql_out, encoding="utf-8")

        print("=== Load into Cloud SQL ===")
        rc = subprocess.run(
            [
                "docker", "run", "--rm",
                "-e", f"PGPASSWORD={db_password}",
                "-v", f"{csv_host}:/data/flood_risk_areas.csv:ro",
                "-v", f"{load_sql}:/data/load.sql:ro",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={db_user} dbname={db_name} sslmode=disable"
                ),
                "-v", "ON_ERROR_STOP=1",
                "-f", "/data/load.sql",
            ]
        ).returncode
        return rc
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
