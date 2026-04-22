"""
Flood Risk Map API
==================
Serves flood risk areas as GeoJSON, and proxies TiTiler tile URLs
for raster layers (JRC water, GEE susceptibility).
"""

import os
import json
import logging
import urllib.parse as up
import base64

import httpx
from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import Response

router = APIRouter()
log = logging.getLogger(__name__)

TITILER_BASE = os.getenv("TITILER_URL", "http://titiler")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0i8AAAAASUVORK5CYII="
)

OVERLAY_METADATA = {
    "jrc_occurrence": {
        "label": "JRC Global Surface Water",
        "legend": {
            "type": "gradient",
            "title": "JRC Water Occurrence",
            "subtitle": "Historical surface water presence",
            "min_label": "0%",
            "max_label": "100%",
            "gradient": "linear-gradient(90deg, #081d58 0%, #225ea8 45%, #41b6c4 75%, #c7e9b4 100%)",
        },
        "render": {
            "bidx": "1",
            "rescale": "0,100",
            "colormap_name": "ocean",
        },
    },
    "gee_susceptibility_classes": {
        "label": "Flood Susceptibility",
        "legend": {
            "type": "categories",
            "title": "Flood Susceptibility",
            "subtitle": "Clipped to Nigeria boundary",
            "items": [
                {"label": "Highly Susceptible", "color": "#800026", "range": "> 75"},
                {"label": "High", "color": "#e31a1c", "range": "51-75"},
                {"label": "Moderate", "color": "#fd8d3c", "range": "26-50"},
                {"label": "Low", "color": "#feb24c", "range": "0-25"},
            ],
        },
        "render": {
            "bidx": "1",
            "rescale": "1,4",
            "resampling": "nearest",
            "colormap_name": "ylorrd",
        },
    },
}


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
            SELECT DISTINCT ON (source) id, source, label, tile_url, valid_from, valid_to, created_at
            FROM flood_risk_tiles
            ORDER BY source, created_at DESC
        """)

    # Rewrite stored TiTiler/MinIO URLs to go through our proxy endpoint,
    # so the browser only talks to localhost:8000 (no direct titiler/minio access needed).
    def _proxy_url(raw_url: str, request: Request, render: dict | None = None) -> str:
        """Extract the COG s3:// url and return a proxied tile template."""
        # raw_url is like: http://titiler:8000/cog/tiles/{z}/{x}/{y}.png?url=s3://...
        parsed = up.urlparse(raw_url)
        qs = up.parse_qs(parsed.query)
        cog_url = qs.get("url", [raw_url])[0]
        base = str(request.base_url).rstrip("/")
        params = {"url": cog_url}
        if render:
            params.update(render)
        encoded = up.urlencode(params, doseq=True, safe=":,")
        return f"{base}/flood-risk/tiles/{{z}}/{{x}}/{{y}}.png?{encoded}"

    async def _fetch_bounds(cog_url: str) -> list[float] | None:
        info_url = f"{TITILER_BASE}/cog/info?url={up.quote(cog_url, safe=':/')}"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(info_url)
                resp.raise_for_status()
                payload = resp.json()
                return payload.get("bounds")
        except Exception:
            log.warning("Could not fetch bounds for %s", cog_url)
            return None

    layers = []
    for r in rows:
        metadata = OVERLAY_METADATA.get(r["source"])
        if not metadata:
            continue
        parsed = up.urlparse(r["tile_url"])
        qs = up.parse_qs(parsed.query)
        cog_url = qs.get("url", [r["tile_url"]])[0]
        layers.append({
            "id":         r["id"],
            "source":     r["source"],
            "label":      metadata["label"],
            "tile_url":   _proxy_url(r["tile_url"], request, metadata.get("render")),
            "valid_from": str(r["valid_from"]) if r["valid_from"] else None,
            "valid_to":   str(r["valid_to"])   if r["valid_to"]   else None,
            "legend":     metadata["legend"],
            "bounds":     await _fetch_bounds(cog_url),
        })

    source_order = {
        "gee_susceptibility_classes": 0,
        "jrc_occurrence": 1,
    }
    layers.sort(key=lambda layer: source_order.get(layer["source"], 99))
    return layers


# ── TiTiler tile proxy ────────────────────────────────────────────────────────
@router.get("/tiles/{z}/{x}/{y}.png")
async def proxy_tile(
    z: int, x: int, y: int,
    url: str = Query(...),
    bidx: str | None = Query(default=None),
    colormap_name: str | None = Query(default=None),
    colormap: str | None = Query(default=None),
    rescale: str | None = Query(default=None),
    resampling: str | None = Query(default=None),
):
    """
    Proxy raster tiles through the backend so the frontend doesn't need
    direct MinIO access. Passes the COG URL to TiTiler.
    """
    params = {"url": url}
    if bidx:
        params["bidx"] = bidx
    if colormap_name:
        params["colormap_name"] = colormap_name
    if colormap:
        params["colormap"] = colormap
    if rescale:
        params["rescale"] = rescale
    if resampling:
        params["resampling"] = resampling
    tile_url = (
        f"{TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png"
        f"?{up.urlencode(params, doseq=True, safe=':,{}[]')}"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(tile_url)
            resp.raise_for_status()
            return Response(
                content=resp.content,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return Response(
                content=TRANSPARENT_PNG,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=3600"},
            )
        log.exception("Tile proxy request failed for %s", tile_url)
        raise HTTPException(status_code=503, detail=f"Tile server error: {exc}")
    except Exception as exc:
        log.exception("Tile proxy request failed for %s", tile_url)
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
