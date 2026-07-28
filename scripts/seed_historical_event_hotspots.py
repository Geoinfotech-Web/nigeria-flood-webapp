"""Seed historical flood events + hotspots into Cloud SQL.

Uses the local GEE-backed ingest script against Cloud SQL through the Cloud SQL
Proxy, so the same normalization logic is used locally and in GCP.
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
        [*gcloud_cmd(), "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={PROJECT}"],
        text=True,
    ).strip()


def main() -> int:
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

        env = os.environ.copy()
        env.update(
            {
                "DB_HOST": "127.0.0.1",
                "DB_PORT": PROXY_PORT,
                "DB_USER": db_user,
                "DB_PASSWORD": db_password,
                "DB_NAME": db_name,
            }
        )
        cmd = [sys.executable, str(ROOT / "ingest" / "flood_risk" / "historical_events.py")]
        return subprocess.run(cmd, env=env, cwd=ROOT).returncode
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
