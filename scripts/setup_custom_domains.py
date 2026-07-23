"""Attach gfw.ggis.africa (Firebase) + api.gfw.ggis.africa (Cloud Run) and print DNS.

Current DNS for both names points at Namecheap LiteSpeed (199.188.205.18).
Web team must replace those records with the Google targets printed here.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = "ggis-flood-watch"
SITE = "ggis-flood-watch"
REGION = "europe-west1"
FRONTEND_DOMAIN = "gfw.ggis.africa"
API_DOMAIN = "api.gfw.ggis.africa"
API_SERVICE = "gfw-api"
HOSTING_API = "https://firebasehosting.googleapis.com/v1beta1"
RUN_API = "https://run.googleapis.com/v1"


def gcloud_cmd() -> list[str]:
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = Path.home() / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    if fallback.exists():
        return [str(fallback)]
    raise FileNotFoundError("gcloud not found")


def token() -> str:
    return subprocess.check_output(
        [*gcloud_cmd(), "auth", "print-access-token"], text=True
    ).strip()


def req(method: str, url: str, data: dict | None = None) -> dict:
    body = None if data is None else json.dumps(data).encode()
    headers = {
        "Authorization": f"Bearer {token()}",
        "x-goog-user-project": PROJECT,
        "Content-Type": "application/json",
    }
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        err = exc.read().decode()
        raise RuntimeError(f"{method} {url} -> {exc.code}: {err}") from exc


def setup_firebase_domain() -> dict:
    parent = f"projects/{PROJECT}/sites/{SITE}"
    list_url = f"{HOSTING_API}/{parent}/customDomains"
    existing = req("GET", list_url)
    for item in existing.get("customDomains") or []:
        name = item.get("name") or ""
        if name.endswith(f"/customDomains/{FRONTEND_DOMAIN}"):
            print(f"Firebase domain already present: {FRONTEND_DOMAIN}")
            return req("GET", f"{HOSTING_API}/{name}")

    print(f"Creating Firebase custom domain {FRONTEND_DOMAIN} ...")
    create_url = f"{list_url}?customDomainId={FRONTEND_DOMAIN}"
    # Empty body is valid; Hosting returns requiredDnsUpdates.
    op = req("POST", create_url, {})
    print("Create operation:", json.dumps(op, indent=2)[:2000])
    # Fetch domain resource (may still be provisioning)
    get_url = f"{HOSTING_API}/{parent}/customDomains/{FRONTEND_DOMAIN}"
    try:
        return req("GET", get_url)
    except RuntimeError:
        return op


def setup_cloud_run_domain() -> dict:
    # Fully managed domain mapping
    parent = f"projects/{PROJECT}/locations/{REGION}"
    name = f"{parent}/domainmappings/{API_DOMAIN}"
    try:
        current = req("GET", f"{RUN_API}/{name}")
        print(f"Cloud Run domain already present: {API_DOMAIN}")
        return current
    except RuntimeError as exc:
        if "404" not in str(exc) and "NOT_FOUND" not in str(exc):
            print("GET domain mapping note:", exc)

    body = {
        "apiVersion": "domains.cloudrun.com/v1",
        "kind": "DomainMapping",
        "metadata": {"name": API_DOMAIN},
        "spec": {
            "routeName": API_SERVICE,
            "certificateMode": "AUTOMATIC",
        },
    }
    print(f"Creating Cloud Run domain mapping {API_DOMAIN} -> {API_SERVICE} ...")
    try:
        return req("POST", f"{RUN_API}/{parent}/domainmappings", body)
    except RuntimeError as exc:
        # Fallback: gcloud beta if REST shape differs
        print("REST domain mapping failed:", exc)
        cmd = [
            *gcloud_cmd(), "beta", "run", "domain-mappings", "create",
            f"--service={API_SERVICE}",
            f"--domain={API_DOMAIN}",
            f"--region={REGION}",
            f"--project={PROJECT}",
            "--quiet",
        ]
        print("+", " ".join(cmd))
        proc = subprocess.run(cmd, capture_output=True, text=True)
        print(proc.stdout)
        print(proc.stderr)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr or proc.stdout) from exc
        return {"status": "created_via_gcloud_beta", "stdout": proc.stdout}


def print_dns_instructions(firebase: dict, run_map: dict) -> None:
    print("\n======== DNS CHANGES FOR WEB TEAM ========")
    print(f"Both {FRONTEND_DOMAIN} and {API_DOMAIN} currently resolve to")
    print("199.188.205.18 (Namecheap LiteSpeed) — replace with Google records below.\n")

    print(f"--- {FRONTEND_DOMAIN} -> Firebase Hosting ---")
    dns = (
        firebase.get("requiredDnsUpdates")
        or firebase.get("dnsUpdates")
        or {}
    )
    print(json.dumps(dns or firebase, indent=2)[:4000])
    print("\nTypical Firebase records (confirm against requiredDnsUpdates above):")
    print("  A     gfw.ggis.africa  →  199.36.158.100")
    print("  TXT   gfw.ggis.africa  →  hosting-site=ggis-flood-watch  (if requested)")
    print("  Or CNAME www / apex per Firebase console instructions.\n")

    print(f"--- {API_DOMAIN} -> Cloud Run ({API_SERVICE}) ---")
    status = run_map.get("status") or {}
    records = status.get("resourceRecords") or run_map.get("status", {}).get("resourceRecords")
    if records:
        for r in records:
            print(f"  {r.get('type')}  {API_DOMAIN}  →  {r.get('rrdata')}")
    else:
        print(json.dumps(run_map, indent=2)[:4000])
        print("\nTypical Cloud Run mapping:")
        print(f"  CNAME  {API_DOMAIN}  →  ghs.googlehosted.com.")
    print("==========================================\n")


def main() -> int:
    firebase = setup_firebase_domain()
    run_map = setup_cloud_run_domain()
    print_dns_instructions(firebase, run_map)

    out = Path(__file__).resolve().parents[1] / "scripts" / "custom_domain_dns.json"
    out.write_text(
        json.dumps({"firebase": firebase, "cloud_run": run_map}, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
