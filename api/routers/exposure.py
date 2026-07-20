"""Static exposure layers for roads, bridges, and populated places."""

from __future__ import annotations

import asyncio
import json
import math
import os
import urllib.parse as up
from functools import lru_cache
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.prepared import prep

router = APIRouter()
_http = httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "NigeriaFloodDashboard/1.0"})
TITILER_BASE = os.getenv("TITILER_URL", "http://titiler")

SUSCEPTIBILITY_LABELS = {
    1: "Low",
    2: "Moderate",
    3: "High",
    4: "Highly Susceptible",
}

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
    "buildings": {
        "label": "Buildings",
        "description": (
            "OpenStreetMap building footprints loaded for the current map view "
            "(centroids). Use with flood risk zones to see exposure."
        ),
    },
}

BUILDING_CLASS_MAP = {
    "apartments": "Residential",
    "residential": "Residential",
    "house": "Residential",
    "detached": "Residential",
    "semidetached_house": "Residential",
    "terrace": "Residential",
    "bungalow": "Residential",
    "cabin": "Residential",
    "dormitory": "Residential",
    "commercial": "Commercial",
    "retail": "Commercial",
    "office": "Commercial",
    "supermarket": "Commercial",
    "kiosk": "Commercial",
    "industrial": "Industrial",
    "warehouse": "Industrial",
    "manufacture": "Industrial",
    "factory": "Industrial",
    "school": "Public",
    "university": "Public",
    "college": "Public",
    "hospital": "Public",
    "clinic": "Public",
    "church": "Public",
    "mosque": "Public",
    "temple": "Public",
    "chapel": "Public",
    "civic": "Public",
    "government": "Public",
    "public": "Public",
}

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]
_overpass_http = httpx.AsyncClient(
    timeout=httpx.Timeout(60.0, connect=15.0),
    headers={"User-Agent": "NigeriaFloodDashboard/1.0"},
    follow_redirects=True,
)

SETTLEMENT_CLASSES = {"City", "Town", "Village", "city", "town", "village"}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_cog_url(tile_url: str) -> str:
    parsed = up.urlparse(tile_url)
    qs = up.parse_qs(parsed.query)
    return qs.get("url", [tile_url])[0]


async def _latest_susceptibility_cog(request: Request) -> str | None:
    try:
        async with request.app.state.db.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT tile_url FROM flood_risk_tiles
                WHERE source = 'gee_susceptibility_classes'
                ORDER BY created_at DESC
                LIMIT 1
                """
            )
        if not row:
            return None
        return _extract_cog_url(row["tile_url"])
    except Exception:
        return None


async def _sample_susceptibility(cog_url: str, lon: float, lat: float) -> dict:
    """Sample classified susceptibility COG at a lon/lat point via TiTiler."""
    try:
        resp = await _http.get(
            f"{TITILER_BASE}/cog/point/{lon},{lat}",
            params={"url": cog_url, "bidx": 1},
        )
        resp.raise_for_status()
        payload = resp.json()
        values = payload.get("values") or []
        if not values or values[0] is None:
            return {
                "susceptibility_class": None,
                "susceptibility": None,
            }
        class_id = int(round(float(values[0])))
        return {
            "susceptibility_class": class_id,
            "susceptibility": SUSCEPTIBILITY_LABELS.get(class_id),
        }
    except Exception:
        return {
            "susceptibility_class": None,
            "susceptibility": None,
        }


async def _enrich_with_susceptibility(request: Request, places: list[dict]) -> list[dict]:
    cog_url = await _latest_susceptibility_cog(request)
    if not cog_url or not places:
        for place in places:
            place.setdefault("susceptibility_class", None)
            place.setdefault("susceptibility", None)
        return places

    samples = await asyncio.gather(
        *[_sample_susceptibility(cog_url, p["lon"], p["lat"]) for p in places]
    )
    for place, sample in zip(places, samples):
        place.update(sample)
    return places


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

    # Buildings are fetched on-demand for the current map/place extent (too large nationwide).
    manifest.append({
        "id": "buildings",
        "available": True,
        "feature_count": None,
        "on_demand": True,
        **LAYER_META["buildings"],
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
    request: Request,
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
    results = results[:limit]
    return await _enrich_with_susceptibility(request, results)


ROAD_CLASS_RANK = {
    "Highway": 0,
    "Major Road": 1,
    "Secondary Road": 2,
    "Tertiary Road": 3,
}


def _simplify_line_coords(coords: list, max_pts: int = 80) -> list:
    if len(coords) <= max_pts:
        return [[float(c[0]), float(c[1])] for c in coords if len(c) >= 2]
    step = (len(coords) - 1) / (max_pts - 1)
    out = []
    for i in range(max_pts):
        pt = coords[int(round(i * step))]
        if len(pt) >= 2:
            out.append([float(pt[0]), float(pt[1])])
    return out


def _road_midpoint(coords: list) -> tuple[float, float] | None:
    if not coords:
        return None
    mid = coords[len(coords) // 2]
    if len(mid) < 2:
        return None
    return float(mid[0]), float(mid[1])


def _road_display_name(props: dict) -> str:
    name = (props.get("name") or "").strip()
    ref = (props.get("ref") or "").strip()
    road_class = props.get("class") or "Road"
    if name and ref:
        return f"{name} ({ref})"
    if name:
        return name
    if ref:
        return ref
    return f"Unnamed {road_class}"


def _road_group_key(props: dict, label: str) -> str:
    name = (props.get("name") or "").strip().lower()
    ref = (props.get("ref") or "").strip().lower()
    road_class = (props.get("class") or "").strip().lower()
    if ref:
        return f"ref:{ref}|{road_class}"
    if name:
        return f"name:{name}|{road_class}"
    return f"osm:{props.get('osm_id')}"


def _prefer_road_name(current: str | None, candidate: str | None) -> str:
    cur = (current or "").strip()
    cand = (candidate or "").strip()
    if not cur:
        return cand
    if not cand:
        return cur
    cur_unnamed = cur.lower().startswith("unnamed")
    cand_unnamed = cand.lower().startswith("unnamed")
    if cur_unnamed and not cand_unnamed:
        return cand
    if not cur_unnamed and cand_unnamed:
        return cur
    # Prefer longer descriptive names (e.g. "Ibb way (A233)" over "A233")
    return cand if len(cand) > len(cur) else cur

def _min_vertex_distance_km(lat: float, lon: float, coords: list) -> float:
    """Approximate distance from point to polyline via sampled vertices."""
    if not coords:
        return float("inf")
    step = max(1, len(coords) // 12)
    best = float("inf")
    for i in range(0, len(coords), step):
        pt = coords[i]
        if len(pt) < 2:
            continue
        d = _haversine_km(lat, lon, float(pt[1]), float(pt[0]))
        if d < best:
            best = d
    # Always include endpoints + midpoint
    for idx in (0, len(coords) // 2, len(coords) - 1):
        pt = coords[idx]
        if len(pt) < 2:
            continue
        d = _haversine_km(lat, lon, float(pt[1]), float(pt[0]))
        if d < best:
            best = d
    return best


@router.get("/nearby-roads")
async def nearby_roads(
    request: Request,
    lat: float = Query(..., description="Centre latitude"),
    lon: float = Query(..., description="Centre longitude"),
    radius_km: float = Query(12, ge=2, le=40),
    limit: int = Query(20, ge=1, le=50),
    min_susceptibility: int = Query(
        2,
        ge=1,
        le=4,
        description="Minimum susceptibility class to include (1=Low … 4=Highly Susceptible)",
    ),
):
    """
    Return major OSM roads near a searched or user location, classified by
    flood susceptibility (Low → Highly Susceptible). Residential streets are
    not in the exposure layer — only highway/primary/secondary/tertiary.
    """
    pad_lat = radius_km / 111.0
    pad_lon = radius_km / max(111.0 * abs(math.cos(math.radians(lat))), 1e-6)
    grouped: dict[str, dict] = {}

    try:
        data = _load_layer("roads")
    except FileNotFoundError:
        return {
            "roads": [],
            "summary": {
                "total_in_radius": 0,
                "returned": 0,
                "at_risk": 0,
                "by_susceptibility": {},
                "by_class": {},
                "radius_km": radius_km,
                "note": "Road exposure data is not available.",
            },
        }

    total_in_radius = 0
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        mid = _road_midpoint(coords)
        if not mid:
            continue
        mid_lon, mid_lat = mid
        if abs(mid_lat - lat) > pad_lat or abs(mid_lon - lon) > pad_lon:
            continue

        distance = _min_vertex_distance_km(lat, lon, coords)
        if distance > radius_km:
            continue

        total_in_radius += 1
        props = feature.get("properties") or {}
        label = _road_display_name(props)
        key = _road_group_key(props, label)
        road_class = props.get("class") or "Road"
        candidate = {
            "name": label,
            "class": road_class,
            "highway": props.get("highway"),
            "ref": props.get("ref"),
            "osm_id": props.get("osm_id"),
            "lat": mid_lat,
            "lon": mid_lon,
            "distance_km": round(distance, 1),
            "bridge": bool(props.get("bridge")),
            "coordinates": _simplify_line_coords(coords),
        }
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = candidate
        else:
            existing["name"] = _prefer_road_name(existing.get("name"), candidate.get("name"))
            if candidate["distance_km"] < existing["distance_km"]:
                existing["distance_km"] = candidate["distance_km"]
                existing["lat"] = candidate["lat"]
                existing["lon"] = candidate["lon"]
                existing["osm_id"] = candidate["osm_id"]
                existing["coordinates"] = candidate["coordinates"]
            existing["bridge"] = existing.get("bridge") or candidate.get("bridge")

    roads = list(grouped.values())
    # Cap before TiTiler sampling — dense cities can have hundreds of segments.
    roads.sort(
        key=lambda r: (
            ROAD_CLASS_RANK.get(r.get("class"), 9),
            r.get("distance_km", 999),
            1 if str(r.get("name", "")).lower().startswith("unnamed") else 0,
        )
    )
    sample_cap = max(limit * 4, 80)
    roads = await _enrich_with_susceptibility(request, roads[:sample_cap])

    # Keep Moderate+ by default; still allow Low when min_susceptibility=1
    filtered = [
        r
        for r in roads
        if (r.get("susceptibility_class") or 0) >= min_susceptibility
    ]

    by_susceptibility = {
        "Highly Susceptible": 0,
        "High": 0,
        "Moderate": 0,
        "Low": 0,
    }
    by_class: dict[str, int] = {}
    for r in filtered:
        sus = r.get("susceptibility")
        if sus in by_susceptibility:
            by_susceptibility[sus] += 1
        cls = r.get("class") or "Road"
        by_class[cls] = by_class.get(cls, 0) + 1

    at_risk = by_susceptibility["High"] + by_susceptibility["Highly Susceptible"]

    filtered.sort(
        key=lambda r: (
            -(r.get("susceptibility_class") or 0),
            1 if str(r.get("name", "")).lower().startswith("unnamed") else 0,
            ROAD_CLASS_RANK.get(r.get("class"), 9),
            r.get("distance_km", 999),
        )
    )

    returned = filtered[:limit]
    return {
        "roads": returned,
        "summary": {
            "total_in_radius": total_in_radius,
            "unique_named": len(grouped),
            "returned": len(returned),
            "at_risk": at_risk,
            "by_susceptibility": by_susceptibility,
            "by_class": by_class,
            "radius_km": radius_km,
            "min_susceptibility": min_susceptibility,
            "note": (
                "Major OSM roads only (highway to tertiary). "
                "Local residential streets are not included."
            ),
        },
    }


_TIER_RANK = {"Normal": 0, "Watch": 1, "Warning": 2, "Emergency": 3}


@router.get("/affected-settlements-summary")
async def affected_settlements_summary(
    request: Request,
    radius_km: float = Query(25, ge=5, le=80),
    min_tier: str = Query(
        "Warning",
        description="Minimum risk tier: Watch, Warning, or Emergency",
    ),
):
    """
    Count unique towns/villages/cities within radius_km of gauges that currently
    have elevated flood outlook (Warning/Emergency by default = highly likely).
    """
    min_rank = _TIER_RANK.get(min_tier, 2)
    # v3 returns the full places list (no 80-item cap) for the public outlook panel.
    cache_key = f"affected-settlements:v3:{min_tier}:{radius_km}"
    try:
        cached = await request.app.state.redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        cached = None

    async with request.app.state.db.acquire() as conn:
        stations = await conn.fetch(
            "SELECT id, name, lat, lon, state FROM gauge_stations ORDER BY name"
        )

    # Prefer live ML outlook; fall back to recent alert_log if serving fails
    from routers.predictions import get_predictions

    elevated = []
    for row in stations:
        tier = None
        flood_prob = None
        try:
            pred = await get_predictions(row["id"], request)
            tier = pred.get("overall_risk")
            horizons = pred.get("horizons") or {}
            flood_prob = max(
                (h.get("flood_prob") or 0) for h in horizons.values()
            ) if horizons else None
        except Exception:
            tier = None

        if tier is None or _TIER_RANK.get(tier, 0) < min_rank:
            continue
        elevated.append({
            "id": row["id"],
            "name": row["name"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "state": row["state"],
            "risk_tier": tier,
            "flood_prob": flood_prob,
        })

    if not elevated:
        async with request.app.state.db.acquire() as conn:
            alert_rows = await conn.fetch(
                """
                SELECT DISTINCT ON (gs.id)
                    gs.id, gs.name, gs.lat, gs.lon, gs.state,
                    al.risk_tier, al.flood_prob
                FROM alert_log al
                JOIN gauge_stations gs ON gs.id = al.station_id
                WHERE al.risk_tier = ANY($1::text[])
                  AND al.created_at > NOW() - INTERVAL '48 hours'
                ORDER BY gs.id, al.created_at DESC
                """,
                [t for t, r in _TIER_RANK.items() if r >= min_rank and t != "Normal"],
            )
        elevated = [
            {
                "id": r["id"],
                "name": r["name"],
                "lat": float(r["lat"]),
                "lon": float(r["lon"]),
                "state": r["state"],
                "risk_tier": r["risk_tier"],
                "flood_prob": float(r["flood_prob"]) if r["flood_prob"] is not None else None,
            }
            for r in alert_rows
        ]

    seen = {}
    by_class = {"City": 0, "Town": 0, "Village": 0}
    station_counts = []

    for station in elevated:
        nearby = await nearby_settlements(
            request,
            lat=station["lat"],
            lon=station["lon"],
            radius_km=radius_km,
            limit=30,
            exclude_name=None,
        )
        local_new = 0
        for place in nearby:
            key = f"{place['name'].lower()}|{round(place['lat'], 3)}|{round(place['lon'], 3)}"
            if key not in seen:
                seen[key] = {
                    **place,
                    "nearest_station": station["name"],
                    "station_risk_tier": station["risk_tier"],
                }
                cls = place.get("class") if place.get("class") in by_class else "Town"
                by_class[cls] = by_class.get(cls, 0) + 1
                local_new += 1
        station_counts.append({
            "station_id": station["id"],
            "station_name": station["name"],
            "state": station["state"],
            "risk_tier": station["risk_tier"],
            "flood_prob": station["flood_prob"],
            "settlements_in_buffer": local_new,
        })

    class_rank = {"City": 0, "Town": 1, "Village": 2}
    places = sorted(
        seen.values(),
        key=lambda p: (
            -_TIER_RANK.get(p.get("station_risk_tier") or "", 0),
            class_rank.get(p.get("class") or "Town", 1),
            (p.get("name") or "").lower(),
        ),
    )
    places_out = [
        {
            "name": p.get("name"),
            "class": p.get("class") or "Town",
            "lat": p.get("lat"),
            "lon": p.get("lon"),
            "display_name": p.get("display_name") or f"{p.get('name')}, Nigeria",
            "population": p.get("population"),
            "susceptibility": p.get("susceptibility"),
            "susceptibility_class": p.get("susceptibility_class"),
            "nearest_station": p.get("nearest_station"),
            "station_risk_tier": p.get("station_risk_tier"),
            "distance_km": p.get("distance_km"),
        }
        for p in places
    ]

    payload = {
        "total": len(seen),
        "highly_likely": len(seen),
        "radius_km": radius_km,
        "min_tier": min_tier,
        "elevated_stations": len(elevated),
        "by_class": by_class,
        "stations": station_counts,
        "places": places_out,
        "label": (
            f"{len(seen)} towns/villages within {int(radius_km)} km of "
            f"{min_tier}+ flood outlook gauges"
        ),
    }

    try:
        await request.app.state.redis.setex(cache_key, 60, json.dumps(payload))
    except Exception:
        pass

    return payload


def _building_class(tags: dict) -> str:
    raw = (tags.get("building") or "yes").strip().lower()
    if raw in ("yes", "true", "1"):
        return "Building"
    return BUILDING_CLASS_MAP.get(raw, "Building")


def _overpass_elements_to_buildings(elements: list, limit: int) -> list[dict]:
    features = []
    for el in elements:
        tags = el.get("tags") or {}
        if "building" not in tags:
            continue
        center = el.get("center") or {}
        lat = center.get("lat")
        lon = center.get("lon")
        if lat is None or lon is None:
            # nodes
            lat = el.get("lat")
            lon = el.get("lon")
        if lat is None or lon is None:
            continue
        name = (tags.get("name") or "").strip() or None
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(float(lon), 6), round(float(lat), 6)],
            },
            "properties": {
                "osm_id": el.get("id"),
                "osm_type": el.get("type"),
                "name": name,
                "class": _building_class(tags),
                "building": tags.get("building"),
                "levels": tags.get("building:levels") or tags.get("levels"),
            },
        })
        if len(features) >= limit:
            break
    return features


async def _fetch_overpass_buildings(query: str) -> list:
    last_error = None
    for base in OVERPASS_URLS:
        for method in ("post", "get"):
            try:
                if method == "post":
                    resp = await _overpass_http.post(base, data={"data": query})
                else:
                    resp = await _overpass_http.get(base, params={"data": query})
                if resp.status_code >= 400:
                    last_error = f"{base} → HTTP {resp.status_code}"
                    continue
                payload = resp.json() or {}
                return payload.get("elements") or []
            except Exception as exc:
                last_error = exc
                continue
    raise HTTPException(
        status_code=502,
        detail=f"Overpass building query failed: {last_error}",
    )


def _bbox_cache_key(west: float, south: float, east: float, north: float, limit: int) -> str:
    # ~0.01° ~ 1 km — coarse enough to reuse nearby pans
    return (
        "buildings-bbox:"
        f"{round(west, 2)}:{round(south, 2)}:{round(east, 2)}:{round(north, 2)}:{limit}"
    )


async def _buildings_in_bbox(
    west: float,
    south: float,
    east: float,
    north: float,
    limit: int = 2000,
    redis=None,
) -> dict:
    # Guard against huge areas
    if east < west:
        west, east = east, west
    if north < south:
        south, north = north, south
    span_lat = abs(north - south)
    span_lon = abs(east - west)
    if span_lat > 0.25 or span_lon > 0.25:
        raise HTTPException(
            status_code=400,
            detail="Buildings layer requires a smaller map view (zoom in closer).",
        )

    cache_key = _bbox_cache_key(west, south, east, north, limit)
    if redis is not None:
        try:
            cached = await redis.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Ways only + qt (quadtile) ordering — much faster than relations + full around scan
    query = f"""
[out:json][timeout:45];
way["building"]({south},{west},{north},{east});
out center qt;
"""
    elements = await _fetch_overpass_buildings(query)
    features = _overpass_elements_to_buildings(elements, limit)
    payload = {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "count": len(features),
            "bbox": [west, south, east, north],
            "source": "openstreetmap/overpass",
            "note": "Building centroids for the current map extent.",
        },
    }
    if redis is not None:
        try:
            await redis.setex(cache_key, 300, json.dumps(payload))
        except Exception:
            pass
    return payload


async def _buildings_around(
    lat: float,
    lon: float,
    radius_km: float,
    limit: int = 1500,
    redis=None,
) -> list[dict]:
    """Fetch buildings via a tight bbox, then keep those within radius_km."""
    pad_lat = radius_km / 111.0
    pad_lon = radius_km / max(111.0 * abs(math.cos(math.radians(lat))), 1e-6)
    west, east = lon - pad_lon, lon + pad_lon
    south, north = lat - pad_lat, lat + pad_lat
    collection = await _buildings_in_bbox(
        west, south, east, north, limit=max(limit * 2, 800), redis=redis
    )
    nearby = []
    for feat in collection.get("features") or []:
        coords = feat["geometry"]["coordinates"]
        blon, blat = float(coords[0]), float(coords[1])
        dist = _haversine_km(lat, lon, blat, blon)
        if dist > radius_km:
            continue
        props = dict(feat["properties"] or {})
        props["lat"] = blat
        props["lon"] = blon
        props["distance_km"] = round(dist, 2)
        props["name"] = props.get("name") or props.get("class") or "Building"
        nearby.append({"type": "Feature", "geometry": feat["geometry"], "properties": props})
        if len(nearby) >= limit:
            break
    nearby.sort(key=lambda f: f["properties"].get("distance_km", 999))
    return nearby


async def _load_prepared_flood_zones(
    request: Request,
    tiers: list[str],
    lat: float,
    lon: float,
    radius_km: float,
):
    """Load flood_risk_areas near a point for the given tiers."""
    pad = max(radius_km / 111.0, 0.05)
    west, east = lon - pad, lon + pad
    south, north = lat - pad, lat + pad

    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT name, state, risk_tier, risk_score,
                   ST_AsGeoJSON(geom)::json AS geometry
            FROM flood_risk_areas
            WHERE risk_tier = ANY($1::text[])
              AND source IN ('sar_dem_inundation', 'urban_flash_flood')
              AND geom && ST_MakeEnvelope($2, $3, $4, $5, 4326)
            ORDER BY
              CASE risk_tier
                WHEN 'Emergency' THEN 3
                WHEN 'Warning' THEN 2
                WHEN 'Watch' THEN 1
                ELSE 0
              END DESC,
              risk_score DESC
            """,
            tiers,
            west,
            south,
            east,
            north,
        )

    by_tier: dict[str, list] = {t: [] for t in tiers}
    zones_meta = []
    for row in rows:
        geom = row["geometry"]
        if isinstance(geom, str):
            geom = json.loads(geom)
        try:
            shp = shape(geom)
        except Exception:
            continue
        tier = row["risk_tier"]
        by_tier.setdefault(tier, []).append(shp)
        zones_meta.append({
            "name": row["name"],
            "state": row["state"],
            "risk_tier": tier,
            "risk_score": float(row["risk_score"]) if row["risk_score"] is not None else None,
        })

    prepared = {}
    for tier, geoms in by_tier.items():
        if geoms:
            prepared[tier] = prep(unary_union(geoms))
    return prepared, zones_meta


async def _classify_features_against_zones(
    request: Request,
    features: list[dict],
    tiers: list[str],
    lat: float,
    lon: float,
    radius_km: float,
) -> tuple[list[dict], dict, list, str | None]:
    """Annotate building features with zone_tier / exposed."""
    tier_rank = {"Moderate": 1, "Likely": 2, "High": 3, "Highly Likely": 4, "Very High": 5}
    prepared, zones_meta = await _load_prepared_flood_zones(
        request, tiers, lat, lon, radius_km
    )
    note = None
    by_class: dict[str, int] = {}
    by_zone_tier: dict[str, int] = {t: 0 for t in tiers}
    listed = []

    for feat in features:
        props = dict(feat.get("properties") or {})
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        blon, blat = float(coords[0]), float(coords[1])
        cls = props.get("class") or "Building"
        by_class[cls] = by_class.get(cls, 0) + 1
        pt = Point(blon, blat)
        matched = [tier for tier, prep_g in prepared.items() if prep_g.intersects(pt)]
        highest = max(matched, key=lambda t: tier_rank.get(t, 0)) if matched else None
        if highest:
            by_zone_tier[highest] = by_zone_tier.get(highest, 0) + 1

        dist = props.get("distance_km")
        if dist is None:
            dist = round(_haversine_km(lat, lon, blat, blon), 2)

        listed.append({
            "osm_id": props.get("osm_id"),
            "osm_type": props.get("osm_type"),
            "name": props.get("name") or cls or "Building",
            "class": cls,
            "building": props.get("building"),
            "levels": props.get("levels"),
            "lat": blat,
            "lon": blon,
            "distance_km": dist,
            "zone_tier": highest,
            "exposed": highest is not None,
        })

    listed.sort(
        key=lambda r: (
            0 if r.get("exposed") else 1,
            -(tier_rank.get(r.get("zone_tier") or "Normal", 0)),
            r.get("distance_km") if r.get("distance_km") is not None else 999,
        )
    )
    summary = {
        "total_in_radius": len(listed),
        "exposed_in_flood_zones": sum(by_zone_tier.values()),
        "by_zone_tier": by_zone_tier,
        "by_class": by_class,
        "zones_considered": zones_meta[:12],
    }
    return listed, summary, zones_meta, note


async def _attach_susceptibility(
    request: Request,
    rows: list[dict],
    max_samples: int = 120,
) -> tuple[dict[str, int], int]:
    """Sample GEE susceptibility (Low→Highly Susceptible) for building centroids."""
    by_susceptibility = {
        "Highly Susceptible": 0,
        "High": 0,
        "Moderate": 0,
        "Low": 0,
    }
    if not rows:
        return by_susceptibility, 0

    # Prefer nearby / already-sorted rows; never sample more than max_samples
    sample = rows[:max_samples]
    await _enrich_with_susceptibility(request, sample)

    for row in sample:
        sus = row.get("susceptibility")
        if sus in by_susceptibility:
            by_susceptibility[sus] += 1

    # Re-rank: higher susceptibility first, then zone exposure, then distance
    rows.sort(
        key=lambda r: (
            -(r.get("susceptibility_class") or 0),
            0 if r.get("exposed") else 1,
            r.get("distance_km") if r.get("distance_km") is not None else 999,
        )
    )
    return by_susceptibility, len(sample)


@router.get("/buildings")
async def buildings_layer(
    request: Request,
    west: float = Query(..., description="BBox west (min lon)"),
    south: float = Query(..., description="BBox south (min lat)"),
    east: float = Query(..., description="BBox east (max lon)"),
    north: float = Query(..., description="BBox north (max lat)"),
    limit: int = Query(2000, ge=100, le=5000),
    with_zones: bool = Query(
        False,
        description="Annotate each building with flood-zone + susceptibility classes",
    ),
    min_tier: str = Query(
        "Moderate",
        description="Minimum riverine flood-zone tier when with_zones=true: Moderate, High, or Very High",
    ),
    list_limit: int = Query(60, ge=10, le=150),
):
    """OpenStreetMap buildings for a map viewport (centroids)."""
    collection = await _buildings_in_bbox(
        west, south, east, north, limit, redis=getattr(request.app.state, "redis", None)
    )
    if not with_zones:
        return collection

    tier_rank = {"Moderate": 1, "Likely": 2, "High": 3, "Highly Likely": 4, "Very High": 5}
    min_rank = tier_rank.get(min_tier, 1)
    tiers = [t for t, r in tier_rank.items() if r >= min_rank]
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    radius_km = max(
        _haversine_km(center_lat, center_lon, south, west),
        _haversine_km(center_lat, center_lon, north, east),
        1.0,
    )

    listed, summary, _zones, note = await _classify_features_against_zones(
        request,
        collection.get("features") or [],
        tiers,
        center_lat,
        center_lon,
        radius_km,
    )

    sample_n = max(list_limit, 120)
    by_susceptibility, sus_n = await _attach_susceptibility(request, listed, sample_n)
    summary["by_susceptibility"] = by_susceptibility
    summary["susceptibility_sample_size"] = sus_n
    summary["high_susceptibility"] = (
        by_susceptibility.get("Highly Susceptible", 0) + by_susceptibility.get("High", 0)
    )

    # Attach zone + susceptibility props onto GeoJSON for map symbology
    classified_by_id = {row["osm_id"]: row for row in listed if row.get("osm_id") is not None}
    for feat in collection.get("features") or []:
        props = feat.setdefault("properties", {})
        hit = classified_by_id.get(props.get("osm_id"))
        if not hit:
            continue
        props["zone_tier"] = hit.get("zone_tier")
        props["exposed"] = hit.get("exposed")
        props["susceptibility"] = hit.get("susceptibility")
        props["susceptibility_class"] = hit.get("susceptibility_class")

    collection["buildings"] = listed[:list_limit]
    collection["summary"] = {
        **summary,
        "listed": min(len(listed), list_limit),
        "radius_km": round(radius_km, 2),
        "min_tier": min_tier,
        "scope": "map_viewport",
        "note": note
        or (
            "Buildings in the current map view. Zones use SAR+DEM inundation and urban flash-flood polygons. "
            "Susceptibility = Low → Highly Susceptible from the flood susceptibility layer."
        ),
    }
    return collection


@router.get("/nearby-buildings")
async def nearby_buildings(
    request: Request,
    lat: float = Query(..., description="Centre latitude"),
    lon: float = Query(..., description="Centre longitude"),
    radius_km: float = Query(3, ge=1, le=10),
    limit: int = Query(1200, ge=50, le=3000),
    list_limit: int = Query(40, ge=10, le=100),
    min_tier: str = Query(
        "Moderate",
        description="Minimum riverine flood-zone tier to count as exposed: Moderate, High, or Very High",
    ),
):
    """
    List OSM buildings near a searched/user location with flood-zone exposure
    and flood susceptibility class (Low → Highly Susceptible).
    """
    tier_rank = {"Moderate": 1, "Likely": 2, "High": 3, "Highly Likely": 4, "Very High": 5}
    min_rank = tier_rank.get(min_tier, 1)
    tiers = [t for t, r in tier_rank.items() if r >= min_rank]
    if not tiers:
        tiers = ["Moderate", "High", "Very High", "Likely", "Highly Likely"]

    cache_key = (
        f"nearby-buildings:v4:{round(lat, 3)}:{round(lon, 3)}:"
        f"{radius_km}:{min_tier}:{limit}:{list_limit}"
    )
    try:
        cached = await request.app.state.redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    try:
        features = await _buildings_around(
            lat,
            lon,
            radius_km,
            limit,
            redis=getattr(request.app.state, "redis", None),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Building fetch failed: {exc}") from exc

    listed, summary, _zones, note = await _classify_features_against_zones(
        request, features, tiers, lat, lon, radius_km
    )
    sample_n = max(list_limit, 120)
    by_susceptibility, sus_n = await _attach_susceptibility(request, listed, sample_n)
    summary["by_susceptibility"] = by_susceptibility
    summary["susceptibility_sample_size"] = sus_n
    summary["high_susceptibility"] = (
        by_susceptibility.get("Highly Susceptible", 0) + by_susceptibility.get("High", 0)
    )

    payload = {
        "buildings": listed[:list_limit],
        "summary": {
            **summary,
            "listed": min(len(listed), list_limit),
            "radius_km": radius_km,
            "min_tier": min_tier,
            "scope": "place_radius",
            "note": note
            or (
                "Nearby OSM buildings with flood-zone exposure and susceptibility class "
                "(Low → Highly Susceptible). Pan the map with the Buildings tab open to refresh."
            ),
        },
    }

    try:
        await request.app.state.redis.setex(cache_key, 300, json.dumps(payload))
    except Exception:
        pass

    return payload


@router.get("/{layer_name}")
async def exposure_layer(layer_name: str):
    if layer_name == "buildings":
        raise HTTPException(
            status_code=400,
            detail="Use /exposure/buildings?west=&south=&east=&north= for the buildings layer.",
        )
    if layer_name not in LAYER_FILES:
        raise HTTPException(status_code=404, detail="Unknown exposure layer")

    try:
        return _load_layer(layer_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Exposure data not found: {exc.filename}") from exc
