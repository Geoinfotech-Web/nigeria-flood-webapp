"""Deploy frontend/dist to Firebase Hosting via REST (uses gcloud user token)."""
from __future__ import annotations

import gzip
import hashlib
import json
import mimetypes
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT = "ggis-flood-watch"
SITE = "ggis-flood-watch"
ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend" / "dist"
API = "https://firebasehosting.googleapis.com/v1beta1"


def gcloud_cmd() -> list[str]:
    import shutil
    for name in ("gcloud.cmd", "gcloud"):
        path = shutil.which(name)
        if path:
            return [path]
    fallback = Path.home() / "AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd"
    if fallback.exists():
        return [str(fallback)]
    raise FileNotFoundError("gcloud not found")


def gcloud_token() -> str:
    return subprocess.check_output(
        [*gcloud_cmd(), "auth", "print-access-token"], text=True
    ).strip()


def req(method: str, url: str, token: str, data: dict | None = None, raw: bytes | None = None,
        content_type: str = "application/json",
        extra_headers: dict | None = None) -> dict | bytes:
    body = None
    headers = {
        "Authorization": f"Bearer {token}",
        "x-goog-user-project": PROJECT,
    }
    if extra_headers:
        headers.update(extra_headers)
    if raw is not None:
        body = raw
        headers["Content-Type"] = content_type
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            payload = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            if "application/json" in ctype:
                return json.loads(payload.decode() or "{}")
            return payload
    except urllib.error.HTTPError as exc:
        err = exc.read().decode()
        raise RuntimeError(f"{method} {url} -> {exc.code}: {err}") from exc


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not (DIST / "index.html").exists():
        print("Missing frontend/dist — run npm run build first", file=sys.stderr)
        return 1

    token = gcloud_token()
    files: dict[str, str] = {}
    path_by_hash: dict[str, Path] = {}
    gz_by_hash: dict[str, bytes] = {}
    for path in DIST.rglob("*"):
        if not path.is_file():
            continue
        rel = "/" + path.relative_to(DIST).as_posix()
        raw = path.read_bytes()
        gz = gzip.compress(raw, compresslevel=9, mtime=0)
        digest = hashlib.sha256(gz).hexdigest()
        files[rel] = digest
        path_by_hash[digest] = path
        gz_by_hash[digest] = gz

    print(f"Creating version for site {SITE} ({len(files)} files)…")
    version = req("POST", f"{API}/sites/{SITE}/versions", token, {
        "config": {
            "rewrites": [{"glob": "**", "path": "/index.html"}],
            "headers": [{
                "glob": "/assets/**",
                "headers": {"Cache-Control": "public,max-age=31536000,immutable"},
            }],
        }
    })
    version_name = version["name"]
    print("Version:", version_name)

    pop = req("POST", f"{API}/{version_name}:populateFiles", token, {"files": files})
    upload_url = pop.get("uploadUrl")
    to_upload = pop.get("uploadRequiredHashes") or []
    print(f"Upload required: {len(to_upload)} files")

    for digest in to_upload:
        path = path_by_hash[digest]
        req(
            "POST",
            f"{upload_url}/{digest}",
            token,
            raw=gz_by_hash[digest],
            content_type="application/octet-stream",
        )
        print("  uploaded", path.relative_to(DIST))

    print("Finalizing version…")
    req(
        "PATCH",
        f"{API}/{version_name}?update_mask=status",
        token,
        {"status": "FINALIZED"},
    )

    print("Releasing to live channel…")
    release = req(
        "POST",
        f"{API}/sites/{SITE}/channels/live/releases?versionName={version_name}",
        token,
        {},
    )
    print(json.dumps(release, indent=2)[:1000])
    print()
    print("Live URLs:")
    print(f"  https://{SITE}.web.app")
    print(f"  https://{SITE}.firebaseapp.com")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
