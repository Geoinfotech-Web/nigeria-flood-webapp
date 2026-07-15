"""Static exposure layers for roads, bridges, and populated places."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
_http = httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "NigeriaFloodDashboard/1.0"})

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LAYER_FILES = {
    "roads": DATA_DIR / "exposure_roads.geojson",
    "bridges": DATA_DIR / "exposure_bridges.geojson",
    "places": DATA_DIR / "exposure_places.geojson",
}
LAYER_META = {
    "roads": {
        "label": "Road Network",
        "description": "OpenStreetMap roads classified into highway, major, secondary, and tertiary roads.",
    },
    "bridges": {
        "label": "Bridges",
        "description": "OpenStreetMap bridges shown as transport crossing points.",
    },
    "places": {
        "label": "Settlements",
        "description": "OpenStreetMap populated places including cities, towns, and villages.",
    },
}

SETTLEMENT_CLASSES = {"City", "Town", "Village", "city", "town", "village"}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@lru_cache(maxsize=4)
def _load_layer(layer_name: str) -> dict:
    path = LAYER_FILES[layer_name]
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/manifest")
async def exposure_manifest():
    manifest = []
    for layer_name, path in LAYER_FILES.items():
        try:
            data = _load_layer(layer_name)
            count = len(data.get("features", []))
            available = True
        except FileNotFoundError:
            count = 0
            available = False

        manifest.append({
            "id": layer_name,
            "available": available,
            "feature_count": count,
            **LAYER_META[layer_name],
        })

    return manifest


async def _nearby_from_nominatim(lat: float, lon: float, radius_km: float, limit: int, exclude: str) -> list:
    """Fallback when local exposure GeoJSON is missing."""
    pad = max(radius_km / 111.0, 0.15)
    viewbox = f"{lon - pad},{lat + pad},{lon + pad},{lat - pad}"
    try:
        resp = await _http.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": "city town village",
                "format": "json",
                "countrycodes": "ng",
                "limit": min(limit * 3, 30),
                "addressdetails": 1,
                "viewbox": viewbox,
                "bounded": 1,
            },
        )
        resp.raise_for_status()
        rows = resp.json()
    except Exception:
        return []

    results = []
    for row in rows:
        name = (row.get("name") or row.get("display_name", "").split(",")[0]).strip()
        if not name or (exclude and name.lower() == exclude):
            continue
        place_lat, place_lon = float(row["lat"]), float(row["lon"])
        distance = _haversine_km(lat, lon, place_lat, place_lon)
        if distance < 0.8 or distance > radius_km:
            continue
        place_type = (row.get("type") or "town").title()
        if place_type.lower() == "hamlet":
            place_type = "Village"
        elif place_type.lower() not in ("city", "town", "village"):
            place_type = "Town"
        results.append({
            "name": name,
            "class": place_type if place_type in ("City", "Town", "Village") else "Town",
            "lat": place_lat,
            "lon": place_lon,
            "distance_km": round(distance, 1),
            "population": None,
            "display_name": row.get("display_name") or f"{name}, Nigeria",
        })

    seen = set()
    unique = []
    for item in sorted(results, key=lambda x: x["distance_km"]):
        key = item["name"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:limit]


@router.get("/nearby-settlements")
async def nearby_settlements(
    lat: float = Query(..., description="Centre latitude"),
    lon: float = Query(..., description="Centre longitude"),
    radius_km: float = Query(25, ge=5, le=80),
    limit: int = Query(8, ge=1, le=20),
    exclude_name: str | None = Query(default=None),
):
    """Return neighbouring OSM cities/towns/villages within a radius."""
    results = []
    exclude = (exclude_name or "").strip().lower()

    try:
        data = _load_layer("places")
        for feature in data.get("features", []):
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            coords = geometry.get("coordinates") or []
            if len(coords) < 2:
                continue

            place_lon, place_lat = float(coords[0]), float(coords[1])
            props = feature.get("properties") or {}
            name = (props.get("name") or "").strip()
            place_class = props.get("class") or props.get("place") or "Settlement"
            if not name or place_class not in SETTLEMENT_CLASSES:
                continue

            distance = _haversine_km(lat, lon, place_lat, place_lon)
            if distance < 0.8 or distance > radius_km:
                continue
            if exclude and name.lower() == exclude:
                continue

            results.append({
                "name": name,
                "class": str(place_class).title() if isinstance(place_class, str) else "Settlement",
                "lat": place_lat,
                "lon": place_lon,
                "distance_km": round(distance, 1),
                "population": props.get("population"),
                "display_name": f"{name}, Nigeria",
            })
    except FileNotFoundError:
        results = []

    if not results:
        results = await _nearby_from_nominatim(lat, lon, radius_km, limit, exclude)

    class_rank = {"City": 0, "Town": 1, "Village": 2}
    results.sort(key=lambda row: (row["distance_km"], class_rank.get(row["class"], 9)))
    return results[:limit]


@router.get("/{layer_name}")
async def exposure_layer(layer_name: str):
    if layer_name not in LAYER_FILES:
        raise HTTPException(status_code=404, detail="Unknown exposure layer")

    try:
        return _load_layer(layer_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Exposure data not found: {exc.filename}") from exc
