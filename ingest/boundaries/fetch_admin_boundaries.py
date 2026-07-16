"""
Download Nigeria administrative boundaries (states + LGAs) from geoBoundaries
and write simplified GeoJSON into api/data/.

Sources (CC BY 4.0 — attribution required):
  https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM1/
  https://www.geoboundaries.org/api/current/gbOpen/NGA/ADM2/

Outputs:
  api/data/admin_states.geojson
  api/data/admin_lgas.geojson
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "api" / "data"
API_BASE = "https://www.geoboundaries.org/api/current/gbOpen/NGA"

LAYERS = {
    "states": {
        "api_level": "ADM1",
        "filename": "admin_states.geojson",
        "admin_level": "state",
        "label": "State",
    },
    "lgas": {
        "api_level": "ADM2",
        "filename": "admin_lgas.geojson",
        "admin_level": "lga",
        "label": "LGA",
    },
}


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "NigeriaFloodDashboard/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)


def normalize_feature(feature: dict, admin_level: str) -> dict | None:
    props = feature.get("properties") or {}
    name = (
        props.get("shapeName")
        or props.get("name")
        or props.get("NAME_1")
        or props.get("NAME_2")
        or props.get("ADM1_EN")
        or props.get("ADM2_EN")
    )
    if not name:
        return None

    parent = (
        props.get("shapeGroup")
        or props.get("ADM1_EN")
        or props.get("NAME_1")
        or props.get("state")
    )
    # For LGAs, parent state often lives in ADM1Name-like fields
    state_name = (
        props.get("shapeGroup")  # often ISO, not useful
        if False
        else props.get("ADM1Name")
        or props.get("ADM1_EN")
        or props.get("NAME_1")
        or props.get("state")
    )

    geometry = feature.get("geometry")
    if not geometry:
        return None

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "name": str(name).strip(),
            "admin_level": admin_level,
            "state": str(state_name).strip() if state_name else None,
            "source": "geoBoundaries",
            "license": "CC BY 4.0",
            "shapeID": props.get("shapeID") or props.get("shapeid"),
        },
    }


def download_layer(key: str, meta: dict) -> Path:
    api_url = f"{API_BASE}/{meta['api_level']}/"
    print(f"Resolving {key} metadata: {api_url}")
    info = fetch_json(api_url)
    download_url = info.get("simplifiedGeometryGeoJSON") or info.get("gjDownloadURL")
    if not download_url:
        raise RuntimeError(f"No download URL for {key}: {info.keys()}")

    print(f"Downloading {key}: {download_url}")
    payload = fetch_json(download_url)
    features = []
    for feat in payload.get("features") or []:
        normalized = normalize_feature(feat, meta["admin_level"])
        if normalized:
            features.append(normalized)

    out = {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "label": meta["label"],
            "admin_level": meta["admin_level"],
            "source": "geoBoundaries gbOpen",
            "license": "CC BY 4.0",
            "attribution": "geoBoundaries (William & Mary geoLab)",
            "boundary_year": info.get("boundaryYearRepresented"),
            "feature_count": len(features),
        },
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / meta["filename"]
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    size_mb = path.stat().st_size / (1024 * 1024)
    print(f"Wrote {path} ({len(features)} features, {size_mb:.2f} MB)")
    return path


def assign_lga_states(states_path: Path, lgas_path: Path) -> None:
    """Fill LGA parent state via point-in-polygon against state polygons."""
    try:
        from shapely.geometry import shape
    except ImportError:
        print("shapely not installed — skipping LGA→state assignment")
        return

    states = json.loads(states_path.read_text(encoding="utf-8"))
    lgas = json.loads(lgas_path.read_text(encoding="utf-8"))
    state_geoms = [
        (f["properties"]["name"], shape(f["geometry"]))
        for f in states.get("features", [])
        if f.get("geometry")
    ]
    updated = 0
    for feat in lgas.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        poly = shape(geom)
        try:
            point = poly.representative_point()
        except Exception:
            point = poly.centroid
        for name, state_geom in state_geoms:
            if state_geom.contains(point) or state_geom.intersects(point):
                feat["properties"]["state"] = name
                updated += 1
                break

    lgas_path.write_text(json.dumps(lgas, separators=(",", ":")), encoding="utf-8")
    print(f"Assigned parent state on {updated} LGAs")


def main() -> None:
    paths = {}
    for key, meta in LAYERS.items():
        paths[key] = download_layer(key, meta)
    assign_lga_states(paths["states"], paths["lgas"])
    print("Done.")


if __name__ == "__main__":
    main()
