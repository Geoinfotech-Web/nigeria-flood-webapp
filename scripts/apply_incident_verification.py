"""Apply flood incident verification schema to Cloud SQL."""
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
ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / "tmp_verify_schema.sql").read_text(encoding="utf-8")


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


def main() -> int:
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

        sql_host = Path(tempfile.gettempdir()) / "gfw_verify_schema.sql"
        sql_host.write_text(SQL, encoding="utf-8")
        print("=== Apply verification schema to Cloud SQL ===")
        rc = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-e",
                f"PGPASSWORD={db_password}",
                "-v",
                f"{sql_host}:/data/verify.sql:ro",
                "postgres:16",
                "psql",
                (
                    f"host=host.docker.internal port={PROXY_PORT} "
                    f"user={db_user} dbname={db_name} sslmode=disable"
                ),
                "-v",
                "ON_ERROR_STOP=1",
                "-f",
                "/data/verify.sql",
                "-c",
                "SELECT to_regclass('public.flood_incident_verifications');",
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
