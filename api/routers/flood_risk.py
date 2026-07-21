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
from collections import Counter
from datetime import datetime, timezone
from functools import lru_cache
from math import radians, cos, sin, asin, sqrt
from pathlib import Path

import httpx
from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import Response
from shapely.geometry import shape, LineString, MultiLineString, GeometryCollection
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.strtree import STRtree
from shapely.validation import make_valid

router = APIRouter()
log = logging.getLogger(__name__)

TITILER_BASE = os.getenv("TITILER_URL", "http://titiler")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0i8AAAAASUVORK5CYII="
)
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EXPOSURE_FILES = {
    "roads": DATA_DIR / "exposure_roads.geojson",
    "bridges": DATA_DIR / "exposure_bridges.geojson",
    "places": DATA_DIR / "exposure_places.geojson",
}
DEFAULT_IMPACT_TIERS = (
    "Moderate",
    "High",
    "Very High",
    "Likely",
    "Highly Likely",
    "Warning",
    "Emergency",
)
# Expert impact is driven by inundation probability + urban flash flood extents
# (not synthetic state boxes or gauge-only Watch tiers).
IMPACT_SOURCES = ("sar_dem_inundation", "urban_flash_flood")

OVERLAY_METADATA = {
    "jrc_occurrence": {
        "label": "Inundation History",
        "legend": {
            "type": "categories",
            "title": "Inundation History",
            "subtitle": "JRC Global Surface Water (Landsat) 1984–2021",
            "items": [
                {"label": "> 50%", "color": "#6b21a8", "range": "Very frequent"},
                {"label": "25–50%", "color": "#9333ea", "range": "Frequent"},
                {"label": "5–25%", "color": "#c084fc", "range": "Occasional"},
            ],
        },
        "render": {
            "bidx": "1",
            "resampling": "nearest",
            "colormap": json.dumps(
                {
                    "1": [192, 132, 252, 220],  # 5–25% — Occasional
                    "2": [147, 51, 234, 230],   # 25–50% — Frequent
                    "3": [107, 33, 168, 240],   # >50% — Very frequent
                },
                separators=(",", ":"),
            ),
        },
    },
    "gee_susceptibility_classes": {
        "label": "Flood Susceptibility",
        "legend": {
            "type": "categories",
            "title": "Flood Susceptibility",
            "subtitle": "JRC occurrence + HAND + distance to drainage + slope",
            "items": [
                {"label": "Highly Susceptible", "color": "#800026", "range": "> 75"},
                {"label": "High", "color": "#e31a1c", "range": "51-75"},
                {"label": "Moderate", "color": "#fd8d3c", "range": "26-50"},
                {"label": "Low", "color": "#ffffb2", "range": "0-25"},
            ],
        },
        "render": {
            "bidx": "1",
            "resampling": "nearest",
            # Discrete class values 1-4 — do NOT rescale (breaks colormap lookup)
            "colormap": json.dumps(
                {
                    "1": [255, 255, 178, 255],  # Low — pale yellow
                    "2": [253, 141, 60, 255],   # Moderate — orange
                    "3": [227, 26, 28, 255],    # High
                    "4": [128, 0, 38, 255],     # Highly Susceptible
                },
                separators=(",", ":"),
            ),
        },
    },
}


@lru_cache(maxsize=4)
def _load_exposure_geometries(layer_name: str) -> tuple[tuple[object, dict], ...]:
    path = EXPOSURE_FILES[layer_name]
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry")
        properties = feature.get("properties") or {}
        if not geometry:
            continue
        records.append((shape(geometry), properties))
    return tuple(records)


def _tier_cache_key(tiers: tuple[str, ...]) -> str:
    # v3: inundation + urban flash sources; settlement-derived states
    return "impact-summary:v3:" + ",".join(sorted(tiers))


def _serialise_counter(counter: Counter) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance in km between two WGS84 points."""
    r = 6371.0088
    dlon = radians(lon2 - lon1)
    dlat = radians(lat2 - lat1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(min(1.0, a)))


def _geodesic_length_km(geometry) -> float:
    """Sum geodesic length of line geometries (ignores points/polygons)."""
    if geometry is None or geometry.is_empty:
        return 0.0
    if isinstance(geometry, LineString):
        coords = list(geometry.coords)
        total = 0.0
        for i in range(1, len(coords)):
            lon1, lat1 = coords[i - 1][0], coords[i - 1][1]
            lon2, lat2 = coords[i][0], coords[i][1]
            total += _haversine_km(lon1, lat1, lon2, lat2)
        return total
    if isinstance(geometry, MultiLineString):
        return sum(_geodesic_length_km(part) for part in geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return sum(_geodesic_length_km(part) for part in geometry.geoms)
    # Polygon/MultiPolygon etc. — use exterior ring length as a fallback for area edges
    try:
        boundary = geometry.boundary
        return _geodesic_length_km(boundary)
    except Exception:
        return 0.0


def _safe_geom(geometry):
    """Return a valid geometry or None (skips TopologyException sources)."""
    if geometry is None or geometry.is_empty:
        return None
    try:
        if not geometry.is_valid:
            geometry = make_valid(geometry)
        if geometry.is_empty:
            return None
        # Tiny buffer collapses self-intersections that make_valid leaves behind.
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        return geometry if not geometry.is_empty else None
    except Exception:
        try:
            fixed = geometry.buffer(0)
            return fixed if fixed and not fixed.is_empty else None
        except Exception:
            return None


def _safe_union(geometries):
    """unary_union that tolerates invalid flood polygons."""
    cleaned = []
    for g in geometries:
        fixed = _safe_geom(g)
        if fixed is not None:
            cleaned.append(fixed)
    if not cleaned:
        return None
    try:
        return unary_union(cleaned)
    except Exception as exc:
        log.warning("unary_union failed (%s); falling back to pairwise merge", exc)
        merged = cleaned[0]
        for g in cleaned[1:]:
            try:
                merged = merged.union(g)
            except Exception:
                continue
        return merged


def _severity_rank(tier: str) -> int:
    return {
        "Very High": 5,
        "Highly Likely": 4,  # urban flash / legacy
        "Emergency": 3,
        "High": 3,
        "Likely": 3,  # urban flash / legacy
        "Warning": 2,
        "Moderate": 2,
        "Watch": 1,
        "Normal": 0,
    }.get(tier, 0)


# ── GeoJSON risk areas ────────────────────────────────────────────────────────
@router.get("/geojson")
async def flood_risk_geojson(
    request: Request,
    source: str = Query(
        default=None,
        description="Filter by source: sar_dem_inundation, inundation_history, or urban_flash_flood",
    ),
    min_risk: float = Query(default=0.0, ge=0, le=1),
):
    """
    Returns GeoJSON FeatureCollection of flood risk / inundation areas.
    Returns SAR/DEM inundation (Very High / High / Moderate) by default.
    Inundation history and urban flash flood are served only via explicit ?source=.
    """
    async with request.app.state.db.acquire() as conn:
        if source is None:
            rows = await conn.fetch(
                """
                SELECT name, admin_level, state, risk_score, risk_tier,
                       source, valid_from, valid_to,
                       ST_AsGeoJSON(geom)::json AS geometry
                FROM flood_risk_areas
                WHERE source = 'sar_dem_inundation'
                  AND risk_score >= $1
                  AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
                ORDER BY risk_score DESC, name
                """,
                min_risk,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT name, admin_level, state, risk_score, risk_tier,
                       source, valid_from, valid_to,
                       ST_AsGeoJSON(geom)::json AS geometry
                FROM flood_risk_areas
                WHERE risk_score >= $1 AND source = $2
                ORDER BY valid_from DESC, risk_score DESC
                """,
                min_risk,
                source,
            )

    if not rows:
        return _empty_feature_collection()

    features = []
    seen = set()
    for r in rows:
        key = (r["name"], r["admin_level"], r["source"], r["risk_tier"])
        if key in seen:
            continue
        seen.add(key)
        geom = r["geometry"]
        if isinstance(geom, str):
            geom = json.loads(geom)
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "name":        r["name"],
                "admin_level": r["admin_level"],
                "state":       r["state"],
                "risk_score":  round(r["risk_score"], 3) if r["risk_score"] is not None else None,
                "risk_tier":   r["risk_tier"],
                "source":      r["source"],
                "valid_from":  str(r["valid_from"]) if r["valid_from"] else None,
                "valid_to":    str(r["valid_to"]) if r["valid_to"] else None,
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
        encoded = up.urlencode(params, doseq=True, safe=":/")
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
        # Probability is served as vectors only — skip raster duplicate
        if r["source"] == "sar_dem_inundation":
            continue
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
        "jrc_occurrence": 0,
        "gee_susceptibility_classes": 1,
    }
    layers.sort(key=lambda layer: source_order.get(layer["source"], 99))
    return layers


# ── TiTiler tile proxy ────────────────────────────────────────────────────────
_SUSCEPTIBILITY_COLORMAP = json.dumps(
    {
        "1": [255, 255, 178, 255],
        "2": [253, 141, 60, 255],
        "3": [227, 26, 28, 255],
        "4": [128, 0, 38, 255],
    },
    separators=(",", ":"),
)


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
    if resampling:
        params["resampling"] = resampling

    # Discrete class rasters. Never rescale — rescale remaps class IDs.
    is_discrete = (
        "susceptibility_classes" in (url or "")
        or "inundation_history" in (url or "")
        or "sar_dem_inundation" in (url or "")
        or "inundation" in (url or "")
    )
    if is_discrete:
        if colormap:
            params["colormap"] = colormap
        elif "susceptibility_classes" in (url or ""):
            params["colormap"] = _SUSCEPTIBILITY_COLORMAP
        params.setdefault("bidx", "1")
        params.setdefault("resampling", "nearest")
    else:
        if colormap_name:
            params["colormap_name"] = colormap_name
        if colormap:
            params["colormap"] = colormap
        if rescale:
            params["rescale"] = rescale

    tile_url = (
        f"{TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png"
        f"?{up.urlencode(params, doseq=True, safe=':/')}"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(tile_url)
            resp.raise_for_status()
            return Response(
                content=resp.content,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=60"},
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
                SELECT DISTINCT ON (name, admin_level, source) risk_tier
                FROM flood_risk_areas
                WHERE source = ANY($1::text[])
                ORDER BY name, admin_level, source, valid_from DESC
            ) t
            GROUP BY risk_tier
        """, list(IMPACT_SOURCES))
    return {r["risk_tier"]: r["count"] for r in rows}


@router.get("/urban-flash-summary")
async def urban_flash_summary(request: Request):
    """
    Lightweight counts + top urban flash flood zones (Likely / Highly Likely).
    Used by Expert KPI cards so they stay in sync with the map layer even when
    the heavier impact-summary intersection is slow or failing.
    """
    cache_key = "urban-flash-summary:v1"
    cached = await request.app.state.redis.get(cache_key)
    if cached:
        return json.loads(cached)

    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (name, admin_level, risk_tier)
                name, admin_level, state, risk_tier, risk_score
            FROM flood_risk_areas
            WHERE source = 'urban_flash_flood'
              AND risk_tier = ANY($1::text[])
            ORDER BY name, admin_level, risk_tier, valid_from DESC, risk_score DESC
            """,
            ["Likely", "Highly Likely"],
        )

    areas = [
        {
            "name": r["name"] or "Urban flash zone",
            "admin_level": r["admin_level"],
            "state": r["state"],
            "risk_tier": r["risk_tier"],
            "risk_score": float(r["risk_score"] or 0),
        }
        for r in rows
    ]
    areas.sort(
        key=lambda a: (
            -_severity_rank(a["risk_tier"]),
            -a["risk_score"],
            a["name"],
        )
    )
    payload = {
        "likely": sum(1 for a in areas if a["risk_tier"] == "Likely"),
        "highly_likely": sum(1 for a in areas if a["risk_tier"] == "Highly Likely"),
        "total": len(areas),
        "top_areas": areas[:8],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await request.app.state.redis.set(cache_key, json.dumps(payload), ex=300)
    return payload


@router.get("/impact-summary")
async def impact_summary(
    request: Request,
    tiers: list[str] | None = Query(default=None, description="Risk tiers to include, defaults to Warning + Emergency"),
    station_id: int | None = Query(default=None, description="Optional gauge station id for station-specific analysis"),
    area_name: str | None = Query(default=None, description="Optional flood risk area name for area-specific analysis"),
    admin_level: str | None = Query(default=None, description="Optional flood risk admin level for area-specific analysis"),
):
    requested_tiers = tuple(dict.fromkeys(tiers or list(DEFAULT_IMPACT_TIERS)))
    cache_scope = f"station:{station_id}" if station_id else f"area:{area_name}:{admin_level}" if area_name else "global"
    cache_key = f"{_tier_cache_key(requested_tiers)}:{cache_scope}"
    cached = await request.app.state.redis.get(cache_key)
    if cached:
        return json.loads(cached)

    async def _fetch_rows(conn, selected_tiers: tuple[str, ...], geometry_scope: str = "all"):
        sources = list(IMPACT_SOURCES)
        if geometry_scope == "station_buffer":
            return await conn.fetch(
                """
                WITH station AS (
                    SELECT id, name, state, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
                    FROM gauge_stations
                    WHERE id = $2
                )
                SELECT DISTINCT ON (fra.name, fra.admin_level, fra.source, fra.risk_tier)
                    fra.name, fra.admin_level, fra.state, fra.risk_tier, fra.risk_score,
                    fra.source, ST_AsGeoJSON(fra.geom)::text AS geometry
                FROM flood_risk_areas fra
                JOIN station s ON TRUE
                WHERE fra.risk_tier = ANY($1::text[])
                  AND fra.source = ANY($3::text[])
                  AND ST_DWithin(fra.geom::geography, s.geom::geography, 60000)
                ORDER BY fra.name, fra.admin_level, fra.source, fra.risk_tier,
                         fra.valid_from DESC, fra.risk_score DESC
                """,
                list(selected_tiers), station_id, sources,
            )
        if geometry_scope == "station_state":
            return await conn.fetch(
                """
                WITH station AS (
                    SELECT id, name, state
                    FROM gauge_stations
                    WHERE id = $2
                )
                SELECT DISTINCT ON (fra.name, fra.admin_level, fra.source, fra.risk_tier)
                    fra.name, fra.admin_level, fra.state, fra.risk_tier, fra.risk_score,
                    fra.source, ST_AsGeoJSON(fra.geom)::text AS geometry
                FROM flood_risk_areas fra
                JOIN station s ON TRUE
                WHERE fra.risk_tier = ANY($1::text[])
                  AND fra.source = ANY($3::text[])
                  AND fra.state = s.state
                ORDER BY fra.name, fra.admin_level, fra.source, fra.risk_tier,
                         fra.valid_from DESC, fra.risk_score DESC
                """,
                list(selected_tiers), station_id, sources,
            )
        if geometry_scope == "area":
            return await conn.fetch(
                """
                SELECT DISTINCT ON (name, admin_level, source, risk_tier)
                    name, admin_level, state, risk_tier, risk_score,
                    source, ST_AsGeoJSON(geom)::text AS geometry
                FROM flood_risk_areas
                WHERE risk_tier = ANY($1::text[])
                  AND source = ANY($4::text[])
                  AND name = $2
                  AND admin_level = $3
                ORDER BY name, admin_level, source, risk_tier, valid_from DESC, risk_score DESC
                """,
                list(selected_tiers), area_name, admin_level, sources,
            )
        return await conn.fetch(
            """
            SELECT DISTINCT ON (name, admin_level, source, risk_tier)
                name, admin_level, state, risk_tier, risk_score,
                source, ST_AsGeoJSON(geom)::text AS geometry
            FROM flood_risk_areas
            WHERE risk_tier = ANY($1::text[])
              AND source = ANY($2::text[])
            ORDER BY name, admin_level, source, risk_tier, valid_from DESC, risk_score DESC
            """,
            list(selected_tiers), sources,
        )

    async with request.app.state.db.acquire() as conn:
        context = {"mode": "global", "label": "Nigeria-wide impact summary"}
        if station_id:
            station = await conn.fetchrow(
                "SELECT id, name, state FROM gauge_stations WHERE id = $1",
                station_id,
            )
            if not station:
                raise HTTPException(status_code=404, detail="Station not found")
            context = {
                "mode": "station",
                "station_id": station["id"],
                "label": f"{station['name']} station area",
                "state": station["state"],
            }
            rows = await _fetch_rows(conn, requested_tiers, "station_buffer")
            geometry_scope = "station_buffer"
        elif area_name and admin_level:
            context = {
                "mode": "risk_area",
                "label": f"{area_name} ({admin_level})",
                "area_name": area_name,
                "admin_level": admin_level,
            }
            rows = await _fetch_rows(conn, requested_tiers, "area")
            geometry_scope = "area"
        else:
            rows = await _fetch_rows(conn, requested_tiers)
            geometry_scope = "all"
        effective_tiers = requested_tiers
        note = None
        available_zone_counts = {}

        if not rows:
            available_rows = await conn.fetch(
                """
                SELECT risk_tier, COUNT(*) AS count
                FROM (
                    SELECT DISTINCT ON (name, admin_level, source, risk_tier) risk_tier
                    FROM flood_risk_areas
                    WHERE source = ANY($1::text[])
                    ORDER BY name, admin_level, source, risk_tier, valid_from DESC, risk_score DESC
                ) t
                GROUP BY risk_tier
                """,
                list(IMPACT_SOURCES),
            )
            available_zone_counts = {row["risk_tier"]: row["count"] for row in available_rows}
            # Station scope only: broaden to the station's state if the buffer is empty.
            if station_id:
                state_rows = await _fetch_rows(conn, requested_tiers, "station_state")
                if state_rows:
                    rows = state_rows
                    geometry_scope = "station_state"
                    note = "No inundation or urban-flash zones were found near this station, so this summary uses zones in the station's state."

    if not rows:
        payload = {
            "requested_tiers": list(requested_tiers),
            "tiers": list(effective_tiers),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "context": context,
            "note": note,
            "available_zones": available_zone_counts,
            "zones": {},
            "states": [],
            "sources": list(IMPACT_SOURCES),
            "roads": {"total": 0, "total_length_km": 0.0, "by_class": {}, "by_tier": {}},
            "bridges": {"total": 0, "by_class": {}, "by_tier": {}},
            "settlements": {
                "total": 0,
                "total_population": 0,
                "by_class": {},
                "by_tier": {},
                "top_places": [],
            },
            "urban_flash": {
                "likely": 0,
                "highly_likely": 0,
                "top_areas": [],
            },
        }
        await request.app.state.redis.set(cache_key, json.dumps(payload), ex=300)
        return payload

    tier_geometries: dict[str, list] = {tier: [] for tier in effective_tiers}
    zone_features: list[dict] = []
    zone_counts: Counter = Counter()
    urban_flash_areas: list[dict] = []
    for row in rows:
        tier = row["risk_tier"]
        geometry = row["geometry"]
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        geom = _safe_geom(shape(geometry))
        if geom is None:
            continue
        # Simplify for spatial index — large SAR polygons otherwise dominate runtime.
        try:
            simple = geom.simplify(0.01, preserve_topology=False)
            if simple is None or simple.is_empty:
                simple = geom
        except Exception:
            simple = geom
        tier_geometries.setdefault(tier, []).append(simple)
        zone_counts[tier] += 1
        zone_features.append({
            "geom": simple,
            "state": row.get("state"),
            "tier": tier,
            "source": row.get("source"),
            "name": row.get("name"),
            "admin_level": row.get("admin_level"),
            "risk_score": float(row["risk_score"] or 0),
        })
        if row.get("source") == "urban_flash_flood" and tier in ("Likely", "Highly Likely"):
            urban_flash_areas.append({
                "name": row.get("name") or "Urban flash zone",
                "state": row.get("state"),
                "risk_tier": tier,
                "risk_score": float(row["risk_score"] or 0),
                "admin_level": row.get("admin_level"),
            })

    # Avoid unary_union of large SAR polygons (slow + TopologyException).
    # Index simplified zone geoms once; look up intersecting zones per exposure feature.
    zone_geoms = [z["geom"] for z in zone_features]
    zone_tree = STRtree(zone_geoms) if zone_geoms else None

    def intersecting_zone_indexes(geometry):
        if zone_tree is None:
            return []
        try:
            hits = zone_tree.query(geometry, predicate="intersects")
            return [int(i) for i in hits]
        except TypeError:
            # Shapely <2 predicate kw unsupported — bbox filter then exact test
            try:
                candidates = zone_tree.query(geometry)
            except Exception:
                return []
            out = []
            for item in candidates:
                idx = int(item) if not hasattr(item, "geom_type") else zone_geoms.index(item)
                try:
                    if zone_geoms[idx].intersects(geometry):
                        out.append(idx)
                except Exception:
                    continue
            return out
        except Exception:
            return []

    def summarise_layer(layer_name: str, class_key: str = "class") -> dict:
        total = 0
        total_length_km = 0.0
        total_population = 0
        by_class = Counter()
        by_tier: dict[str, Counter] = {tier: Counter() for tier in tier_geometries}
        matched_places = []
        settlement_states: set[str] = set()

        for geometry, properties in _load_exposure_geometries(layer_name):
            hit_indexes = intersecting_zone_indexes(geometry)
            if not hit_indexes:
                continue

            matched_tiers = list({zone_features[i]["tier"] for i in hit_indexes})
            if not matched_tiers:
                continue

            total += 1
            label = properties.get(class_key, "Unclassified")
            by_class[label] += 1

            for tier in matched_tiers:
                by_tier.setdefault(tier, Counter())[label] += 1

            if layer_name == "roads":
                # Fast length estimate in km (WGS84 degrees × ~111); avoids per-vertex haversine.
                try:
                    total_length_km += float(geometry.length) * 111.0
                except Exception:
                    pass

            if layer_name == "places":
                highest_tier = max(matched_tiers, key=_severity_rank)
                population_raw = properties.get("population")
                try:
                    population = int(population_raw) if population_raw is not None else None
                except (TypeError, ValueError):
                    population = None
                if population:
                    total_population += population

                place_states = {
                    zone_features[i]["state"]
                    for i in hit_indexes
                    if zone_features[i].get("state")
                }
                settlement_states.update(place_states)

                matched_places.append({
                    "name": properties.get("name", "Unnamed place"),
                    "class": properties.get("class", "Settlement"),
                    "population": population,
                    "risk_tier": highest_tier,
                    "states": sorted(place_states),
                })

        result = {
            "total": total,
            "by_class": _serialise_counter(by_class),
            "by_tier": {tier: _serialise_counter(counter) for tier, counter in by_tier.items()},
        }
        if layer_name == "roads":
            result["total_length_km"] = round(total_length_km, 1)
        if layer_name == "places":
            matched_places.sort(
                key=lambda place: (
                    -_severity_rank(place["risk_tier"]),
                    -(place["population"] or 0),
                    place["name"],
                )
            )
            result["top_places"] = matched_places[:5]
            result["total_population"] = total_population
            result["states"] = sorted(settlement_states)
        return result

    settlements = summarise_layer("places")
    # Prefer states that actually contain exposed towns/villages; fall back to zone states.
    affected_states = settlements.get("states") or sorted(
        {z["state"] for z in zone_features if z.get("state")}
    )

    urban_flash_areas.sort(
        key=lambda a: (
            -_severity_rank(a["risk_tier"]),
            -a["risk_score"],
            a["name"],
        )
    )
    urban_flash = {
        "likely": sum(1 for a in urban_flash_areas if a["risk_tier"] == "Likely"),
        "highly_likely": sum(1 for a in urban_flash_areas if a["risk_tier"] == "Highly Likely"),
        "top_areas": urban_flash_areas[:8],
    }

    payload = {
        "requested_tiers": list(requested_tiers),
        "tiers": list(effective_tiers),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context": context,
        "note": note,
        "available_zones": available_zone_counts,
        "zones": _serialise_counter(zone_counts),
        "states": affected_states,
        "sources": list(IMPACT_SOURCES),
        "roads": summarise_layer("roads"),
        "bridges": summarise_layer("bridges"),
        "settlements": settlements,
        "urban_flash": urban_flash,
    }
    await request.app.state.redis.set(cache_key, json.dumps(payload), ex=300)
    return payload


def _empty_feature_collection() -> dict:
    return {"type": "FeatureCollection", "features": []}
