"""Static exposure layers for roads, bridges, and populated places."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

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


@router.get("/{layer_name}")
async def exposure_layer(layer_name: str):
    if layer_name not in LAYER_FILES:
        raise HTTPException(status_code=404, detail="Unknown exposure layer")

    try:
        return _load_layer(layer_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Exposure data not found: {exc.filename}") from exc
