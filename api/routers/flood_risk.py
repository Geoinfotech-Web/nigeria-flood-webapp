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
from pathlib import Path

import httpx
from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import Response
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.prepared import prep

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
DEFAULT_IMPACT_TIERS = ("Warning", "Emergency", "Moderate", "High", "Very High")

OVERLAY_METADATA = {
    "jrc_occurrence": {
        "label": "Inundation History",
        "legend": {
            "type": "categories",
            "title": "Inundation History",
            "subtitle": "How often an area was under water (clipped to Nigeria)",
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
                    "1": [192, 132, 252, 220],  # 5–25% — light purple (high contrast on white)
                    "2": [147, 51, 234, 230],   # 25–50% — mid purple
                    "3": [107, 33, 168, 240],   # >50% — deep purple
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
            "subtitle": "Clipped to Nigeria boundary",
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
    return "impact-summary:" + ",".join(sorted(tiers))


def _serialise_counter(counter: Counter) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


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
        description="Filter by source: sar_dem_inundation, urban_flash_flood, synthetic, sentinel1",
    ),
    min_risk: float = Query(default=0.0, ge=0, le=1),
):
    """
    Returns GeoJSON FeatureCollection of flood risk / inundation areas.
    Prefers SAR/DEM inundation (Very High / High / Moderate) over synthetic state boxes.
    Urban flash flood is served only via ?source=urban_flash_flood (separate layer).
    """
    prefer_inundation = source is None

    async with request.app.state.db.acquire() as conn:
        if prefer_inundation:
            inundation_rows = await conn.fetch(
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
            if inundation_rows:
                rows = inundation_rows
            else:
                rows = await conn.fetch(
                    """
                    SELECT name, admin_level, state, risk_score, risk_tier,
                           source, valid_from, valid_to,
                           ST_AsGeoJSON(geom)::json AS geometry
                    FROM flood_risk_areas
                    WHERE risk_score >= $1
                      AND source NOT IN ('sentinel1', 'urban_flash_flood')
                    ORDER BY valid_from DESC, risk_score DESC
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
                SELECT DISTINCT ON (name, admin_level) risk_tier
                FROM flood_risk_areas
                ORDER BY name, admin_level, valid_from DESC
            ) t
            GROUP BY risk_tier
        """)
    return {r["risk_tier"]: r["count"] for r in rows}


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
        if geometry_scope == "station_buffer":
            return await conn.fetch(
                """
                WITH station AS (
                    SELECT id, name, state, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
                    FROM gauge_stations
                    WHERE id = $2
                )
                SELECT DISTINCT ON (fra.name, fra.admin_level)
                    fra.name, fra.admin_level, fra.state, fra.risk_tier, fra.risk_score,
                    ST_AsGeoJSON(fra.geom)::text AS geometry
                FROM flood_risk_areas fra
                JOIN station s ON TRUE
                WHERE fra.risk_tier = ANY($1::text[])
                  AND ST_DWithin(fra.geom::geography, s.geom::geography, 60000)
                ORDER BY fra.name, fra.admin_level, fra.valid_from DESC, fra.risk_score DESC
                """,
                list(selected_tiers), station_id,
            )
        if geometry_scope == "station_state":
            return await conn.fetch(
                """
                WITH station AS (
                    SELECT id, name, state
                    FROM gauge_stations
                    WHERE id = $2
                )
                SELECT DISTINCT ON (fra.name, fra.admin_level)
                    fra.name, fra.admin_level, fra.state, fra.risk_tier, fra.risk_score,
                    ST_AsGeoJSON(fra.geom)::text AS geometry
                FROM flood_risk_areas fra
                JOIN station s ON TRUE
                WHERE fra.risk_tier = ANY($1::text[])
                  AND fra.state = s.state
                ORDER BY fra.name, fra.admin_level, fra.valid_from DESC, fra.risk_score DESC
                """,
                list(selected_tiers), station_id,
            )
        if geometry_scope == "area":
            return await conn.fetch(
                """
                SELECT DISTINCT ON (name, admin_level)
                    name, admin_level, state, risk_tier, risk_score,
                    ST_AsGeoJSON(geom)::text AS geometry
                FROM flood_risk_areas
                WHERE risk_tier = ANY($1::text[])
                  AND name = $2
                  AND admin_level = $3
                ORDER BY name, admin_level, valid_from DESC, risk_score DESC
                """,
                list(selected_tiers), area_name, admin_level,
            )
        return await conn.fetch(
            """
            SELECT DISTINCT ON (name, admin_level)
                name, admin_level, state, risk_tier, risk_score,
                ST_AsGeoJSON(geom)::text AS geometry
            FROM flood_risk_areas
            WHERE risk_tier = ANY($1::text[])
            ORDER BY name, admin_level, valid_from DESC, risk_score DESC
            """,
            list(selected_tiers),
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
                    SELECT DISTINCT ON (name, admin_level) risk_tier
                    FROM flood_risk_areas
                    ORDER BY name, admin_level, valid_from DESC, risk_score DESC
                ) t
                GROUP BY risk_tier
                """
            )
            available_zone_counts = {row["risk_tier"]: row["count"] for row in available_rows}
            if station_id:
                state_rows = await _fetch_rows(conn, requested_tiers, "station_state")
                if state_rows:
                    rows = state_rows
                    geometry_scope = "station_state"
                    note = "No warning or emergency zones were found near this station, so this summary is using the active risk areas in the station's state."
            if available_zone_counts.get("Watch"):
                effective_tiers = ("Watch",)
                if station_id and geometry_scope == "station_state":
                    rows = await _fetch_rows(conn, effective_tiers, "station_state")
                    note = "No warning or emergency zones are active for this station, so this summary is using Watch zones in the station's state."
                elif station_id:
                    rows = await _fetch_rows(conn, effective_tiers, "station_buffer")
                    geometry_scope = "station_buffer"
                    note = "No warning or emergency zones are active near this station, so this summary is using Watch zones around the station."
                elif area_name and admin_level:
                    rows = await _fetch_rows(conn, effective_tiers, "area")
                    note = "No warning or emergency tiers are active for this selected area, so this summary is using its Watch zone."
                else:
                    rows = await _fetch_rows(conn, effective_tiers)
                    note = "No warning or emergency zones are active right now, so this summary is using Watch zones."

    if not rows:
        payload = {
            "requested_tiers": list(requested_tiers),
            "tiers": list(effective_tiers),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "context": context,
            "note": note,
            "available_zones": available_zone_counts,
            "zones": {},
            "roads": {"total": 0, "by_class": {}, "by_tier": {}},
            "bridges": {"total": 0, "by_class": {}, "by_tier": {}},
            "settlements": {"total": 0, "by_class": {}, "by_tier": {}, "top_places": []},
        }
        await request.app.state.redis.set(cache_key, json.dumps(payload), ex=300)
        return payload

    tier_geometries: dict[str, list] = {tier: [] for tier in effective_tiers}
    zone_counts: Counter = Counter()
    for row in rows:
        tier = row["risk_tier"]
        geometry = row["geometry"]
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        tier_geometries.setdefault(tier, []).append(shape(geometry))
        zone_counts[tier] += 1

    prepared_by_tier = {
        tier: prep(unary_union(geometries))
        for tier, geometries in tier_geometries.items()
        if geometries
    }

    def summarise_layer(layer_name: str, class_key: str = "class") -> dict:
        total = 0
        by_class = Counter()
        by_tier = {tier: Counter() for tier in prepared_by_tier}
        matched_places = []

        for geometry, properties in _load_exposure_geometries(layer_name):
            matched_tiers = [
                tier
                for tier, prepared_geom in prepared_by_tier.items()
                if prepared_geom.intersects(geometry)
            ]
            if not matched_tiers:
                continue

            total += 1
            label = properties.get(class_key, "Unclassified")
            by_class[label] += 1

            for tier in matched_tiers:
                by_tier[tier][label] += 1

            if layer_name == "places":
                highest_tier = max(matched_tiers, key=_severity_rank)
                population_raw = properties.get("population")
                try:
                    population = int(population_raw) if population_raw is not None else None
                except (TypeError, ValueError):
                    population = None
                matched_places.append({
                    "name": properties.get("name", "Unnamed place"),
                    "class": properties.get("class", "Settlement"),
                    "population": population,
                    "risk_tier": highest_tier,
                })

        result = {
            "total": total,
            "by_class": _serialise_counter(by_class),
            "by_tier": {tier: _serialise_counter(counter) for tier, counter in by_tier.items()},
        }
        if layer_name == "places":
            matched_places.sort(
                key=lambda place: (
                    -_severity_rank(place["risk_tier"]),
                    -(place["population"] or 0),
                    place["name"],
                )
            )
            result["top_places"] = matched_places[:5]
        return result

    payload = {
        "requested_tiers": list(requested_tiers),
        "tiers": list(effective_tiers),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context": context,
        "note": note,
        "available_zones": available_zone_counts,
        "zones": _serialise_counter(zone_counts),
        "roads": summarise_layer("roads"),
        "bridges": summarise_layer("bridges"),
        "settlements": summarise_layer("places"),
    }
    await request.app.state.redis.set(cache_key, json.dumps(payload), ex=300)
    return payload


def _empty_feature_collection() -> dict:
    return {"type": "FeatureCollection", "features": []}
