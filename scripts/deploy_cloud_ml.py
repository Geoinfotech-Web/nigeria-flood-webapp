"""Train flood models against Cloud SQL and deploy BentoML to Cloud Run.

Prerequisites:
  - Real-only data already seeded (scripts/seed_cloud_sql_real.py)
  - Docker + gcloud authenticated for ggis-flood-watch
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
ML_DIR = ROOT / "ml"
STORE = ML_DIR / "bentoml_store"
PROJECT = "ggis-flood-watch"
REGION = "europe-west1"
INSTANCE = "gfw-postgres"
CONNECTION = f"{PROJECT}:{REGION}:{INSTANCE}"
PROXY_PORT = "5433"
IMAGE = f"{REGION}-docker.pkg.dev/{PROJECT}/gfw-ml/ml:latest"
API_SERVICE = "gfw-api"
ML_SERVICE = "gfw-ml"
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


def run(cmd: list[str], **kwargs) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd, **kwargs)


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

    if STORE.exists():
        shutil.rmtree(STORE)
    STORE.mkdir(parents=True)

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

        print("\n=== Build train image (no models yet) ===")
        # Temporary Dockerfile without bentoml_store COPY for training
        train_df = ML_DIR / "Dockerfile.train"
        train_df.write_text(
            "FROM python:3.11-slim\n"
            "WORKDIR /app\n"
            "RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ "
            "&& rm -rf /var/lib/apt/lists/*\n"
            "COPY requirements.txt .\n"
            "RUN pip install --no-cache-dir -r requirements.txt\n"
            "COPY service.py train.py ./\n"
            "ENV BENTOML_HOME=/models\n"
            'CMD ["python", "train.py"]\n',
            encoding="utf-8",
        )
        run(["docker", "build", "-f", str(train_df), "-t", "gfw-ml-train:local", str(ML_DIR)])

        print("\n=== Train models against Cloud SQL ===")
        run([
            "docker", "run", "--rm",
            "--add-host=host.docker.internal:host-gateway",
            "-e", "DB_HOST=host.docker.internal",
            "-e", f"DB_PORT={PROXY_PORT}",
            "-e", f"DB_USER={db_user}",
            "-e", f"DB_PASSWORD={db_password}",
            "-e", f"DB_NAME={db_name}",
            "-e", "FORCE_REGISTER=1",
            "-e", "AUC_GATE=0.55",
            "-e", "F1_GATE=0.35",
            "-e", "BENTOML_HOME=/models",
            "-e", "MLFLOW_TRACKING_URI=file:///tmp/mlruns",
            "-v", f"{STORE}:/models",
            "gfw-ml-train:local",
            "python", "train.py",
        ])

        models_dir = STORE / "models"
        if not models_dir.exists() or not any(models_dir.iterdir()):
            print("ERROR: no models registered under", STORE)
            return 1

        print("\n=== Build + push serving image ===")
        run([
            *gcloud_cmd(), "auth", "configure-docker",
            f"{REGION}-docker.pkg.dev", "--quiet",
        ])
        run(["docker", "build", "-t", IMAGE, str(ML_DIR)])
        run(["docker", "push", IMAGE])

        print("\n=== Deploy Cloud Run gfw-ml ===")
        run([
            *gcloud_cmd(), "run", "deploy", ML_SERVICE,
            "--image", IMAGE,
            "--project", PROJECT,
            "--region", REGION,
            "--platform", "managed",
            "--allow-unauthenticated",
            "--port", "3000",
            "--memory", "2Gi",
            "--cpu", "2",
            "--min-instances", "0",
            "--max-instances", "3",
            "--timeout", "300",
            "--set-env-vars", "BENTOML_HOME=/root/bentoml",
        ])

        ml_url = subprocess.check_output(
            [*gcloud_cmd(), "run", "services", "describe", ML_SERVICE,
             "--project", PROJECT, "--region", REGION,
             "--format=value(status.url)"],
            text=True,
        ).strip()
        print("ML URL:", ml_url)

        print("\n=== Point API at BentoML ===")
        # Preserve existing env and overwrite BENTOML_URL
        run([
            *gcloud_cmd(), "run", "services", "update", API_SERVICE,
            "--project", PROJECT,
            "--region", REGION,
            "--update-env-vars", f"BENTOML_URL={ml_url}",
        ])

        print("\n=== Smoke test ===")
        run(["curl.exe", "-s", f"{ml_url}/health"])
        print()
        run(["curl.exe", "-s",
             "https://gfw-api-883584176276.europe-west1.run.app/stations/1/predictions"])
        print()
        print("\nBentoML deploy complete.")
        return 0
    finally:
        proxy_proc.terminate()
        try:
            proxy_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proxy_proc.kill()
        train_df = ML_DIR / "Dockerfile.train"
        if train_df.exists():
            train_df.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
