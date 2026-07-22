"""Upload local flood-risk COGs to GCS and register them in Cloud SQL."""
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
BUCKET = "gfw-flood-rasters-ggis-flood-watch"
PROXY_URL = (
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/"
    "v2.15.2/cloud-sql-proxy.x64.exe"
)

# Local MinIO object name → Cloud SQL flood_risk_tiles registration
LAYERS = [
    {
        "source": "gee_susceptibility_classes",
        "label": "Flood Susceptibility",
        "object": "nigeria_flood_susceptibility_classes_2026-07-01_monthly.tif",
    },
    {
        "source": "jrc_occurrence",
        "label": "Inundation History",
        "object": "nigeria_inundation_history_classes_2026-07-01_monthly.tif",
    },
]


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
    out_dir = Path(tempfile.gettempdir()) / "gfw-cogs"
    out_dir.mkdir(exist_ok=True)

    print("=== Export COGs from local MinIO ===")
    for layer in LAYERS:
        dest = out_dir / layer["object"]
        if not dest.exists():
            subprocess.check_call([
                "docker", "exec", "flood_minio",
                "mc", "cp", f"local/flood-risk-tiles/{layer['object']}",
                f"/tmp/{layer['object']}",
            ])
            subprocess.check_call([
                "docker", "cp", f"flood_minio:/tmp/{layer['object']}", str(dest),
            ])
        print(" ", dest, dest.stat().st_size)

        gcs = f"gs://{BUCKET}/{layer['object']}"
        print("  upload", gcs)
        subprocess.check_call([
            *gcloud_cmd(), "storage", "cp", str(dest), gcs, f"--project={PROJECT}",
        ])

    tools = Path(tempfile.gettempdir()) / "gfw-cloud-sql"
    tools.mkdir(exist_ok=True)
    proxy = tools / "cloud-sql-proxy.exe"
    if not proxy.exists():
        urllib.request.urlretrieve(PROXY_URL, proxy)

    db_user = secret("DB_USER")
    db_password = secret("DB_PASSWORD")
    db_name = secret("DB_NAME")

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

        sql_parts = [
            "CREATE TABLE IF NOT EXISTS flood_risk_tiles ("
            "  id SERIAL PRIMARY KEY,"
            "  source TEXT NOT NULL,"
            "  label TEXT,"
            "  minio_path TEXT,"
            "  tile_url TEXT,"
            "  valid_from TIMESTAMPTZ,"
            "  valid_to TIMESTAMPTZ,"
            "  created_at TIMESTAMPTZ DEFAULT NOW()"
            ");",
        ]
        for layer in LAYERS:
            gcs = f"gs://{BUCKET}/{layer['object']}"
            tile_url = (
                "http://titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png"
                f"?url={gcs}"
            )
            sql_parts.append(
                f"DELETE FROM flood_risk_tiles WHERE source = '{layer['source']}';"
            )
            sql_parts.append(
                "INSERT INTO flood_risk_tiles "
                "(source, label, minio_path, tile_url, valid_from, valid_to) VALUES ("
                f"'{layer['source']}', '{layer['label']}', '{gcs}', '{tile_url}', "
                "NOW() - INTERVAL '30 days', NOW() + INTERVAL '365 days');"
            )
        sql_parts.append(
            "SELECT source, label, minio_path FROM flood_risk_tiles ORDER BY source;"
        )
        sql = " ".join(sql_parts)
        rc = subprocess.run(
            [
                "docker", "run", "--rm",
                "-e", f"PGPASSWORD={db_password}",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={db_user} dbname={db_name} sslmode=disable"
                ),
                "-v", "ON_ERROR_STOP=1",
                "-c", sql,
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
