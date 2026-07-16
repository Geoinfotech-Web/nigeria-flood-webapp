"""Administrative boundaries (states and LGAs) for map overlay."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LAYER_FILES = {
    "states": DATA_DIR / "admin_states.geojson",
    "lgas": DATA_DIR / "admin_lgas.geojson",
}
LAYER_META = {
    "states": {
        "label": "State boundaries",
        "description": "Nigeria state / FCT administrative boundaries (geoBoundaries).",
        "admin_level": "state",
    },
    "lgas": {
        "label": "LGA boundaries",
        "description": "Local Government Area boundaries (geoBoundaries).",
        "admin_level": "lga",
    },
}


@lru_cache(maxsize=4)
def _load_layer(layer_name: str) -> dict:
    path = LAYER_FILES[layer_name]
    if not path.exists():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/manifest")
async def boundaries_manifest():
    manifest = []
    for layer_id, path in LAYER_FILES.items():
        try:
            data = _load_layer(layer_id)
            count = len(data.get("features", []))
            available = True
            meta_extra = data.get("meta") or {}
        except FileNotFoundError:
            count = 0
            available = False
            meta_extra = {}

        manifest.append({
            "id": layer_id,
            "available": available,
            "feature_count": count,
            "attribution": meta_extra.get("attribution") or "geoBoundaries (CC BY 4.0)",
            **LAYER_META[layer_id],
        })
    return manifest


@router.get("/{layer_name}")
async def boundary_layer(layer_name: str):
    if layer_name not in LAYER_FILES:
        raise HTTPException(status_code=404, detail="Unknown boundary layer")
    try:
        return _load_layer(layer_name)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"Boundary data not found: {exc.filename}. Run ingest/boundaries/fetch_admin_boundaries.py",
        ) from exc
