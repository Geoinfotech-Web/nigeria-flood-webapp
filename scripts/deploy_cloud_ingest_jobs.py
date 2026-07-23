"""Build ingest image + Cloud Run Jobs + Cloud Scheduler (ggis-flood-watch).

Jobs:
  gfw-ingest-real-data     — OpenMeteo + GloFAS (daily)
  gfw-ingest-urban-flash   — urban flash flood classifier (every 3h)

Requires: Docker, gcloud auth, Artifact Registry repo gfw-ingest.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "ggis-flood-watch"
REGION = "europe-west1"
PROJECT_NUMBER = "883584176276"
CONNECTION = f"{PROJECT}:{REGION}:gfw-postgres"
IMAGE = f"{REGION}-docker.pkg.dev/{PROJECT}/gfw-ingest/ingest:latest"
SA = f"gfw-ingest@{PROJECT}.iam.gserviceaccount.com"
SCHEDULER_SA = f"gfw-scheduler@{PROJECT}.iam.gserviceaccount.com"
CLOUD_SQL_SOCKET = f"/cloudsql/{CONNECTION}"


def gcloud_cmd() -> list[str]:
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = Path.home() / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    if fallback.exists():
        return [str(fallback)]
    raise FileNotFoundError("gcloud not found")


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print("+", " ".join(cmd))
    return subprocess.run(cmd, check=check)


def gcloud(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return run([*gcloud_cmd(), *args], check=check)


def ensure_service_accounts() -> None:
    for email, display in (
        (SA, "GFW ingest jobs"),
        (SCHEDULER_SA, "GFW Cloud Scheduler invoker"),
    ):
        exists = subprocess.run(
            [*gcloud_cmd(), "iam", "service-accounts", "describe", email, f"--project={PROJECT}"],
            capture_output=True,
        )
        if exists.returncode != 0:
            gcloud(
                "iam", "service-accounts", "create", email.split("@")[0],
                f"--display-name={display}",
                f"--project={PROJECT}",
            )

    for role in (
        "roles/cloudsql.client",
        "roles/secretmanager.secretAccessor",
        "roles/logging.logWriter",
    ):
        gcloud(
            "projects", "add-iam-policy-binding", PROJECT,
            f"--member=serviceAccount:{SA}",
            f"--role={role}",
            "--condition=None",
            "--quiet",
            check=False,
        )

    # Scheduler SA may invoke Cloud Run Jobs
    gcloud(
        "projects", "add-iam-policy-binding", PROJECT,
        f"--member=serviceAccount:{SCHEDULER_SA}",
        "--role=roles/run.developer",
        "--condition=None",
        "--quiet",
        check=False,
    )


def build_and_push() -> None:
    run(["docker", "build", "-t", IMAGE, str(ROOT / "ingest")])
    run(["docker", "push", IMAGE])


def upsert_job(name: str, command: list[str], memory: str = "1Gi", cpu: str = "1", timeout: str = "1800") -> None:
    env_vars = ",".join(
        [
            f"DB_HOST={CLOUD_SQL_SOCKET}",
            "DB_PORT=5432",
            "MET_HISTORY_DAYS=3",
            "GAUGE_HISTORY_DAYS=3",
            f"INSTANCE_CONNECTION_NAME={CONNECTION}",
        ]
    )
    secrets = ",".join(
        [
            "DB_USER=DB_USER:latest",
            "DB_PASSWORD=DB_PASSWORD:latest",
            "DB_NAME=DB_NAME:latest",
        ]
    )
    common = [
        f"--image={IMAGE}",
        f"--region={REGION}",
        f"--project={PROJECT}",
        f"--service-account={SA}",
        f"--set-cloudsql-instances={CONNECTION}",
        f"--set-env-vars={env_vars}",
        f"--set-secrets={secrets}",
        f"--memory={memory}",
        f"--cpu={cpu}",
        f"--task-timeout={timeout}",
        "--max-retries=1",
        "--tasks=1",
        f"--command={command[0]}",
        f"--args={','.join(command[1:])}",
        "--quiet",
    ]
    described = subprocess.run(
        [*gcloud_cmd(), "run", "jobs", "describe", name, f"--region={REGION}", f"--project={PROJECT}"],
        capture_output=True,
    )
    if described.returncode == 0:
        gcloud("run", "jobs", "update", name, *common)
    else:
        gcloud("run", "jobs", "create", name, *common)

    gcloud(
        "run", "jobs", "add-iam-policy-binding", name,
        f"--region={REGION}",
        f"--project={PROJECT}",
        f"--member=serviceAccount:{SCHEDULER_SA}",
        "--role=roles/run.invoker",
        "--quiet",
        check=False,
    )


def upsert_scheduler(name: str, job: str, schedule: str, description: str) -> None:
    uri = (
        f"https://{REGION}-run.googleapis.com/apis/run.googleapis.com/v1/"
        f"namespaces/{PROJECT}/jobs/{job}:run"
    )
    # Prefer project number form if name-based fails for some orgs
    uri_num = (
        f"https://{REGION}-run.googleapis.com/apis/run.googleapis.com/v1/"
        f"namespaces/{PROJECT_NUMBER}/jobs/{job}:run"
    )
    described = subprocess.run(
        [
            *gcloud_cmd(), "scheduler", "jobs", "describe", name,
            f"--location={REGION}", f"--project={PROJECT}",
        ],
        capture_output=True,
    )
    args = [
        f"--location={REGION}",
        f"--project={PROJECT}",
        f"--schedule={schedule}",
        "--time-zone=UTC",
        f"--uri={uri_num}",
        "--http-method=POST",
        f"--oauth-service-account-email={SCHEDULER_SA}",
        "--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform",
        f"--description={description}",
        "--quiet",
    ]
    if described.returncode == 0:
        gcloud("scheduler", "jobs", "update", "http", name, *args)
    else:
        gcloud("scheduler", "jobs", "create", "http", name, *args)
    _ = uri  # kept for docs / debugging


def main() -> int:
    print("=== Enable APIs ===")
    gcloud(
        "services", "enable",
        "run.googleapis.com",
        "cloudscheduler.googleapis.com",
        "artifactregistry.googleapis.com",
        "sqladmin.googleapis.com",
        "secretmanager.googleapis.com",
        "iam.googleapis.com",
        f"--project={PROJECT}",
        "--quiet",
    )

    print("=== Service accounts + IAM ===")
    ensure_service_accounts()

    print("=== Build + push ingest image ===")
    build_and_push()

    print("=== Cloud Run jobs ===")
    upsert_job(
        "gfw-ingest-real-data",
        ["python", "-m", "flood_risk.real_data", "--once"],
        memory="1Gi",
        timeout="1800",
    )
    upsert_job(
        "gfw-ingest-urban-flash",
        ["python", "-m", "flood_risk.urban_flash_flood"],
        memory="1Gi",
        timeout="1800",
    )

    print("=== Cloud Scheduler ===")
    upsert_scheduler(
        "gfw-real-data-hourly",
        "gfw-ingest-real-data",
        "5 2 * * *",
        "OpenMeteo + GloFAS ingest daily at 02:05 UTC",
    )
    upsert_scheduler(
        "gfw-urban-flash-3h",
        "gfw-ingest-urban-flash",
        "35 */3 * * *",
        "Urban flash flood classifier every 3 hours at :35 UTC",
    )

    print("=== Execute once (smoke) ===")
    gcloud(
        "run", "jobs", "execute", "gfw-ingest-real-data",
        f"--region={REGION}", f"--project={PROJECT}", "--wait", "--quiet",
        check=False,
    )

    print(json.dumps({
        "image": IMAGE,
        "jobs": ["gfw-ingest-real-data", "gfw-ingest-urban-flash"],
        "scheduler": ["gfw-real-data-hourly", "gfw-urban-flash-3h"],
        "db_socket": CLOUD_SQL_SOCKET,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
