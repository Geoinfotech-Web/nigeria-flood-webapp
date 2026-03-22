"""
Flood Risk Map API
==================
Serves flood risk areas as GeoJSON, and proxies TiTiler tile URLs
for raster layers (JRC water, GEE susceptibility).
"""

import os
import json
import logging
from datetime import date

import httpx
from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import Response

router = APIRouter()
log = logging.getLogger(__name__)

TITILER_BASE = os.getenv("TITILER_URL", "http://titiler:8000")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")


# ── GeoJSON risk areas ────────────────────────────────────────────────────────
@router.get("/geojson")
async def flood_risk_geojson(
    request: Request,
    source: str = Query(default=None, description="Filter by source: gee, synthetic, glofast"),
    min_risk: float = Query(default=0.0, ge=0, le=1),
):
    """
    Returns GeoJSON FeatureCollection of flood risk areas.
    Updated by the ingest scheduler (weekly/monthly).
    Falls back to synthetic risk from gauge data if no GEE tiles present.
    """
    query = """
        SELECT name, admin_level, state, risk_score, risk_tier,
               source, valid_from, valid_to,
               ST_AsGeoJSON(geom)::json AS geometry
        FROM flood_risk_areas
        WHERE risk_score >= $1
    """
    params = [min_risk]

    if source:
        query += f" AND source = ${len(params)+1}"
        params.append(source)

    # Prefer freshest data (latest valid_from)
    query += " ORDER BY valid_from DESC, risk_score DESC"

    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(query, *params)

    if not rows:
        # No risk data yet — trigger synthetic generation
        return _empty_feature_collection()

    features = []
    seen = set()
    for r in rows:
        key = (r["name"], r["admin_level"])
        if key in seen:
            continue
        seen.add(key)
        # asyncpg returns ::json cast as a string — parse it into a dict
        geom = r["geometry"]
        if isinstance(geom, str):
            geom = json.loads(geom)
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "name":       r["name"],
                "admin_level":r["admin_level"],
                "state":      r["state"],
                "risk_score": round(r["risk_score"], 3),
                "risk_tier":  r["risk_tier"],
                "source":     r["source"],
                "valid_from": str(r["valid_from"]) if r["valid_from"] else None,
                "valid_to":   str(r["valid_to"])   if r["valid_to"]   else None,
            },
        })

    return {"type": "FeatureCollection", "features": features}


# ── Available tile layers ─────────────────────────────────────────────────────
@router.get("/layers")
async def list_tile_layers(request: Request):
    """List available raster flood risk tile layers with their tile URLs."""
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, source, label, tile_url, valid_from, valid_to, created_at
            FROM flood_risk_tiles
            ORDER BY created_at DESC
        """)

    # Rewrite stored TiTiler/MinIO URLs to go through our proxy endpoint,
    # so the browser only talks to localhost:8000 (no direct titiler/minio access needed).
    def _proxy_url(raw_url: str, request: Request) -> str:
        """Extract the COG s3:// url and return a proxied tile template."""
        import urllib.parse
        # raw_url is like: http://titiler:8000/cog/tiles/{z}/{x}/{y}.png?url=s3://...
        parsed = urllib.parse.urlparse(raw_url)
        qs = urllib.parse.parse_qs(parsed.query)
        cog_url = qs.get("url", [raw_url])[0]
        base = str(request.base_url).rstrip("/")
        encoded = urllib.parse.quote(cog_url, safe="")
        return f"{base}/flood-risk/tiles/{{z}}/{{x}}/{{y}}.png?url={encoded}"

    layers = [
        {
            "id":         r["id"],
            "source":     r["source"],
            "label":      r["label"],
            "tile_url":   _proxy_url(r["tile_url"], request),
            "valid_from": str(r["valid_from"]) if r["valid_from"] else None,
            "valid_to":   str(r["valid_to"])   if r["valid_to"]   else None,
        }
        for r in rows
    ]

    # Always include the public JRC tile as a built-in option (proxied)
    jrc_cog = (
        "https://storage.googleapis.com/earthengine-public/projects/"
        "JRC/GSW1_4/GlobalSurfaceWater/occurrence/00N_000E.tif"
    )
    import urllib.parse as _up
    base = str(request.base_url).rstrip("/")
    layers.insert(0, {
        "id":       "jrc_builtin",
        "source":   "jrc_water",
        "label":    "JRC Global Surface Water (1984–present)",
        "tile_url": f"{base}/flood-risk/tiles/{{z}}/{{x}}/{{y}}.png?url={_up.quote(jrc_cog, safe='')}",
        "valid_from": "1984-03-16",
        "valid_to":   "2021-12-31",
    })

    return layers


# ── TiTiler tile proxy ────────────────────────────────────────────────────────
@router.get("/tiles/{z}/{x}/{y}.png")
async def proxy_tile(
    z: int, x: int, y: int,
    url: str = Query(...),
    colormap: str = Query(default="reds"),
):
    """
    Proxy raster tiles through the backend so the frontend doesn't need
    direct MinIO access. Passes the COG URL to TiTiler.
    """
    tile_url = (
        f"{TITILER_BASE}/cog/tiles/{z}/{x}/{y}.png"
        f"?url={url}&bidx=1&colormap_name={colormap}&rescale=0,100"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(tile_url)
            return Response(
                content=resp.content,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Tile server error: {exc}")


# ── Risk summary (for dashboard widgets) ─────────────────────────────────────
@router.get("/summary")
async def risk_summary(request: Request):
    """Count of areas by risk tier — for the dashboard header."""
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT risk_tier, COUNT(*) AS count
            FROM (
                SELECT DISTINCT ON (name, admin_level) risk_tier
                FROM flood_risk_areas
                ORDER BY name, admin_level, valid_from DESC
            ) t
            GROUP BY risk_tier
        """)
    return {r["risk_tier"]: r["count"] for r in rows}


def _empty_feature_collection() -> dict:
    return {"type": "FeatureCollection", "features": []}
