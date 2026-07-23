"""Copy urban_footprints from local TimescaleDB → Cloud SQL."""
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
    print("=== Dump local urban_footprints ===")
    tmp = Path(tempfile.gettempdir())
    csv_host = tmp / "urban_footprints.csv"
    # Write CSV inside the container then docker cp (avoids Windows encoding issues)
    subprocess.check_call(
        [
            "docker", "exec", "flood_timescaledb",
            "bash", "-c",
            """
            psql -U flood -d flooddb -At -c \"
            COPY (
              SELECT name, state, ST_AsEWKT(geom), centroid_lat, centroid_lon,
                     area_km2, impervious_frac, flat_frac, updated_at
              FROM urban_footprints
            ) TO STDOUT WITH (FORMAT csv, FORCE_QUOTE *)
            \" > /tmp/urban_footprints.csv
            """,
        ]
    )
    subprocess.check_call(
        ["docker", "cp", "flood_timescaledb:/tmp/urban_footprints.csv", str(csv_host)]
    )
    lines = [ln for ln in csv_host.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()]
    print(f"Exported {len(lines)} rows")
    if not lines:
        print("Nothing to migrate — run urban_footprints.py locally first")
        return 1

    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        urllib.request.urlretrieve(PROXY_URL, proxy)

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

        load_sql = tmp / "gfw_load_urban_footprints.sql"
        load_sql.write_text(
            """
BEGIN;
CREATE TABLE IF NOT EXISTS urban_footprints (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    state            TEXT,
    geom             GEOMETRY(MultiPolygon, 4326) NOT NULL,
    centroid_lat     DOUBLE PRECISION NOT NULL,
    centroid_lon     DOUBLE PRECISION NOT NULL,
    area_km2         DOUBLE PRECISION NOT NULL DEFAULT 0,
    impervious_frac  DOUBLE PRECISION NOT NULL DEFAULT 0,
    flat_frac        DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_urban_footprints_geom
    ON urban_footprints USING GIST (geom);
TRUNCATE urban_footprints RESTART IDENTITY;

CREATE TEMP TABLE _uf_import (
  name text,
  state text,
  geom_ewkt text,
  centroid_lat double precision,
  centroid_lon double precision,
  area_km2 double precision,
  impervious_frac double precision,
  flat_frac double precision,
  updated_at timestamptz
);

\\copy _uf_import FROM '/data/urban_footprints.csv' WITH (FORMAT csv)

INSERT INTO urban_footprints
  (name, state, geom, centroid_lat, centroid_lon, area_km2, impervious_frac, flat_frac, updated_at)
SELECT
  name, state,
  ST_Multi(ST_GeomFromEWKT(geom_ewkt))::geometry(MultiPolygon,4326),
  centroid_lat, centroid_lon,
  COALESCE(area_km2, 0), COALESCE(impervious_frac, 0), COALESCE(flat_frac, 0),
  updated_at
FROM _uf_import;

SELECT count(*) AS footprints FROM urban_footprints;
COMMIT;
""",
            encoding="utf-8",
        )

        print("=== Load into Cloud SQL ===")
        return subprocess.run(
            [
                "docker", "run", "--rm",
                "--add-host=host.docker.internal:host-gateway",
                "-e", f"PGPASSWORD={db_password}",
                "-v", f"{csv_host}:/data/urban_footprints.csv:ro",
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
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
