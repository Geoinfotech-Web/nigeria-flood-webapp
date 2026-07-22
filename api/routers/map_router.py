"""GeoJSON risk map endpoint + Google basemap style / tile proxy."""
import json
import os

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response

from services import google_places

router = APIRouter()

RISK_COLOR = {
    "Normal":    "#22c55e",
    "Watch":     "#eab308",
    "Warning":   "#f97316",
    "Emergency": "#ef4444",
}


def _public_base_url(request: Request) -> str:
    """Prefer HTTPS when behind Cloud Run / load balancers (avoid mixed-content tiles)."""
    base = str(request.base_url).rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    if proto == "https" and base.startswith("http://"):
        base = "https://" + base[len("http://"):]
    force = os.getenv("PUBLIC_API_BASE_URL", "").rstrip("/")
    return force or base


@router.get("/google-style")
async def google_basemap_style(
    request: Request,
    map_type: str = Query("roadmap"),
):
    """MapLibre style using Google Map Tiles (tiles proxied; API key stays server-side)."""
    if map_type not in ("roadmap", "satellite", "terrain"):
        raise HTTPException(status_code=400, detail="map_type must be roadmap, satellite, or terrain")
    if not google_places.google_enabled():
        raise HTTPException(status_code=503, detail="GOOGLE_MAPS_API_KEY is not configured")

    # Absolute URL so the browser hits the API host, not the Vite frontend origin.
    base = _public_base_url(request)
    tile_template = f"{base}/map/google-tiles/{{z}}/{{x}}/{{y}}?map_type={map_type}"
    style = await google_places.google_maplibre_style(
        map_type=map_type,
        tile_url_template=tile_template,
    )
    if not style:
        raise HTTPException(
            status_code=503,
            detail=(
                "Google Map Tiles unavailable. Enable the Map Tiles API on your "
                "Google Cloud project, then retry."
            ),
        )
    return style


@router.get("/google-tiles/{z}/{x}/{y}")
async def google_basemap_tile(
    z: int,
    x: int,
    y: int,
    map_type: str = Query("roadmap"),
):
    """Proxy a single Google Map tile (keeps the API key off the client)."""
    if map_type not in ("roadmap", "satellite", "terrain"):
        raise HTTPException(status_code=400, detail="map_type must be roadmap, satellite, or terrain")
    if not google_places.google_enabled():
        raise HTTPException(status_code=503, detail="GOOGLE_MAPS_API_KEY is not configured")
    if z < 0 or z > 22 or x < 0 or y < 0:
        raise HTTPException(status_code=400, detail="Invalid tile coordinates")

    result = await google_places.fetch_google_tile(map_type, z, x, y)
    if not result:
        raise HTTPException(status_code=502, detail="Failed to fetch Google tile")
    content, content_type = result
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/risk")
async def risk_map(request: Request):
    async with request.app.state.db.acquire() as conn:
        stations = await conn.fetch("""
            SELECT id, code, name, river, state, lat, lon, bank_full_m
            FROM gauge_stations
        """)

    features = []
    for s in stations:
        # Latest prediction (from Redis cache if available)
        cache_key = f"pred:{s['id']}"
        cached = await request.app.state.redis.get(cache_key)
        if cached:
            pred = json.loads(cached)
            risk = pred.get("overall_risk", "Normal")
            prob_24h = pred.get("horizons", {}).get("24h", {}).get("flood_prob", 0)
        else:
            risk = "Normal"
            prob_24h = 0.0

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [s["lon"], s["lat"]]},
            "properties": {
                "id":         s["id"],
                "code":       s["code"],
                "name":       s["name"],
                "river":      s["river"],
                "state":      s["state"],
                "bank_full":  s["bank_full_m"],
                "risk_tier":  risk,
                "prob_24h":   prob_24h,
                "color":      RISK_COLOR.get(risk, "#22c55e"),
            },
        })

    return {"type": "FeatureCollection", "features": features}
