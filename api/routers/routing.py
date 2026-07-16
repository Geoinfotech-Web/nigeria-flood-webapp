import asyncio
import json
import os
import re

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from shapely.geometry import LineString, Point

from routers.exposure import _load_layer, _road_display_name

router = APIRouter()
OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org")


@router.get("/route")
async def flood_aware_route(
    request: Request,
    start_lat: float = Query(..., ge=-90, le=90),
    start_lon: float = Query(..., ge=-180, le=180),
    end_lat: float = Query(..., ge=-90, le=90),
    end_lon: float = Query(..., ge=-180, le=180),
):
    """Return a driving route and mapped flood hazards within 500 m of it."""
    url = f"{OSRM_URL}/route/v1/driving/{start_lon},{start_lat};{end_lon},{end_lat}"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params={"overview": "full", "geometries": "geojson", "steps": "true"})
        response.raise_for_status()
        result = response.json()
        if result.get("code") != "Ok" or not result.get("routes"):
            raise ValueError("No drivable route was found")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Routing unavailable: {exc}")

    route = result["routes"][0]
    geometry = route["geometry"]
    route_weather = await _route_weather(route)
    route_street_sequence = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            street = _normalise_street(step.get("name"))
            if street and (not route_street_sequence or route_street_sequence[-1] != street):
                route_street_sequence.append(street)
    route_streets = set(route_street_sequence)
    database_context = await asyncio.to_thread(
        _database_route_context, geometry, route_street_sequence
    )

    async with request.app.state.db.acquire() as conn:
        hazards = await conn.fetch("""
            WITH route AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
            )
            SELECT DISTINCT fra.name, fra.state, fra.risk_tier, fra.risk_score,
                   ROUND(ST_Distance(fra.geom::geography, ST_SetSRID(ST_Point($2, $3), 4326)::geography))::int AS current_distance_m
            FROM flood_risk_areas fra, route
            WHERE risk_tier IN ('Warning', 'Emergency')
              AND ST_DWithin(fra.geom::geography, route.geom::geography, 500)
            ORDER BY risk_score DESC
            LIMIT 20
        """, json.dumps(geometry), start_lon, start_lat)
        reported_rows = await conn.fetch("""
            WITH route AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
            )
            SELECT fir.id, fir.created_at, fir.location_name, fir.affected_street,
                   fir.flood_source, fir.severity, fir.description,
                   CASE WHEN fir.latitude IS NOT NULL AND fir.longitude IS NOT NULL
                     THEN ST_DWithin(
                       ST_SetSRID(ST_Point(fir.longitude, fir.latitude), 4326)::geography,
                       route.geom::geography, 500
                     ) ELSE FALSE END AS near_route
            FROM flood_incident_reports fir, route
            WHERE fir.affected_street IS NOT NULL
              AND fir.created_at >= NOW() - INTERVAL '30 days'
            ORDER BY fir.created_at DESC
            LIMIT 200
        """, json.dumps(geometry))
        settlement_conditions = await _settlement_flood_conditions(
            conn, database_context["settlements"]
        )

    for settlement in database_context["settlements"]:
        condition = settlement_conditions.get(
            (settlement["name"], settlement["lat"], settlement["lon"]), {}
        )
        settlement.update(condition)

    community_hazards = []
    for row in reported_rows:
        report = dict(row)
        reported_street = _normalise_street(report.get("affected_street"))
        matched_street = next(
            (street for street in route_streets if _streets_match(reported_street, street)),
            None,
        )
        if report.pop("near_route") or matched_street:
            report["matched_route_street"] = matched_street
            report["created_at"] = report["created_at"].isoformat()
            community_hazards.append(report)

    mapped_count = len(hazards)
    reported_count = len(community_hazards)
    warning_parts = []
    if mapped_count:
        warning_parts.append(f"{mapped_count} mapped high-risk flood area(s)")
    if reported_count:
        warning_parts.append(f"{reported_count} recently reported flooded street(s)")

    return {
        "route": {"type": "Feature", "properties": {}, "geometry": geometry},
        "distance_m": route["distance"],
        "duration_s": route["duration"],
        "hazards": [dict(row) for row in hazards],
        "community_hazards": community_hazards,
        "route_streets": sorted(route_streets),
        "database_streets": database_context["streets"],
        "database_settlements": database_context["settlements"],
        "street_weather": route_weather,
        "safe": not warning_parts,
        "warning": None if not warning_parts else f"Route approaches {' and '.join(warning_parts)}.",
    }


async def _settlement_flood_conditions(conn, settlements: list[dict]) -> dict:
    """Attach the nearest mapped flood condition to each settlement on a route."""
    if not settlements:
        return {}
    rows = await conn.fetch("""
        WITH places AS (
            SELECT *
            FROM jsonb_to_recordset($1::jsonb)
              AS p(name text, lat double precision, lon double precision)
        )
        SELECT p.name AS settlement_name, p.lat, p.lon,
               risk.name AS risk_area, risk.state, risk.risk_tier,
               risk.risk_score, risk.distance_m
        FROM places p
        LEFT JOIN LATERAL (
            SELECT fra.name, fra.state, fra.risk_tier, fra.risk_score,
                   ROUND(ST_Distance(
                     fra.geom::geography,
                     ST_SetSRID(ST_Point(p.lon, p.lat), 4326)::geography
                   ))::int AS distance_m
            FROM flood_risk_areas fra
            WHERE ST_DWithin(
              fra.geom::geography,
              ST_SetSRID(ST_Point(p.lon, p.lat), 4326)::geography,
              25000
            )
            ORDER BY ST_Distance(
              fra.geom::geography,
              ST_SetSRID(ST_Point(p.lon, p.lat), 4326)::geography
            ), fra.risk_score DESC
            LIMIT 1
        ) risk ON TRUE
    """, json.dumps([
        {"name": item["name"], "lat": item["lat"], "lon": item["lon"]}
        for item in settlements
    ]))
    return {
        (row["settlement_name"], row["lat"], row["lon"]): {
            "risk_area": row["risk_area"],
            "risk_state": row["state"],
            "risk_tier": row["risk_tier"] or "No mapped warning",
            "risk_score": float(row["risk_score"]) if row["risk_score"] is not None else None,
            "risk_distance_km": round(row["distance_m"] / 1000, 1) if row["distance_m"] is not None else None,
        }
        for row in rows
    }


def _normalise_street(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"[^a-z0-9 ]+", " ", value.lower())
    replacements = {"street": "st", "road": "rd", "avenue": "ave", "boulevard": "blvd"}
    return " ".join(replacements.get(word, word) for word in value.split())


def _streets_match(reported: str, routed: str) -> bool:
    if len(reported) < 4 or len(routed) < 4:
        return False
    return reported in routed or routed in reported


async def _route_weather(route: dict) -> list[dict]:
    """Sample current weather at up to five named streets along a route."""
    candidates = []
    seen = set()
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            street = (step.get("name") or "").strip()
            location = (step.get("maneuver") or {}).get("location")
            key = _normalise_street(street)
            if not key or key in seen or not location or len(location) != 2:
                continue
            seen.add(key)
            candidates.append({"street": street, "lon": location[0], "lat": location[1]})
    if len(candidates) > 5:
        indexes = sorted({round(i * (len(candidates) - 1) / 4) for i in range(5)})
        candidates = [candidates[index] for index in indexes]

    async def fetch(sample):
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get("https://api.open-meteo.com/v1/forecast", params={
                    "latitude": sample["lat"], "longitude": sample["lon"],
                    "current": "temperature_2m,precipitation,rain,weather_code,wind_speed_10m",
                    "timezone": "Africa/Lagos",
                })
            response.raise_for_status()
            current = response.json().get("current", {})
            return {
                **sample,
                "temperature_c": current.get("temperature_2m"),
                "precipitation_mm": current.get("precipitation"),
                "rain_mm": current.get("rain"),
                "wind_kmh": current.get("wind_speed_10m"),
                "weather_code": current.get("weather_code"),
                "condition": _weather_condition(current.get("weather_code")),
            }
        except Exception:
            return None

    return [result for result in await asyncio.gather(*(fetch(item) for item in candidates)) if result]


def _weather_condition(code: int | None) -> str:
    if code is None:
        return "Unavailable"
    if code == 0:
        return "Clear"
    if code in (1, 2, 3):
        return "Cloudy"
    if code in (45, 48):
        return "Fog"
    if code in (51, 53, 55, 56, 57):
        return "Drizzle"
    if code in (61, 63, 65, 66, 67, 80, 81, 82):
        return "Rain"
    if code in (71, 73, 75, 77, 85, 86):
        return "Snow"
    if code in (95, 96, 99):
        return "Thunderstorm"
    return "Mixed conditions"


def _database_route_context(geometry: dict, street_sequence: list[str]) -> dict:
    """Match the route with roads and settlements in the local exposure store."""
    line = LineString(geometry.get("coordinates") or [])
    sequence_order = {name: index for index, name in enumerate(street_sequence)}
    road_matches = {}
    try:
        for feature in _load_layer("roads").get("features", []):
            props = feature.get("properties") or {}
            display_name = _road_display_name(props)
            key = _normalise_street(display_name)
            if key not in sequence_order or key in road_matches:
                continue
            road_matches[key] = {
                "name": display_name,
                "class": props.get("class") or "Road",
                "highway": props.get("highway"),
                "ref": props.get("ref"),
                "osm_id": props.get("osm_id"),
                "route_order": sequence_order[key],
            }
    except FileNotFoundError:
        pass
    streets = sorted(road_matches.values(), key=lambda item: item["route_order"])

    settlements = []
    try:
        for feature in _load_layer("places").get("features", []):
            geometry_value = feature.get("geometry") or {}
            if geometry_value.get("type") != "Point":
                continue
            coords = geometry_value.get("coordinates") or []
            props = feature.get("properties") or {}
            name = (props.get("name") or "").strip()
            place_class = str(props.get("class") or props.get("place") or "").title()
            if not name or place_class not in {"City", "Town", "Village"} or len(coords) < 2:
                continue
            point = Point(float(coords[0]), float(coords[1]))
            distance_km = line.distance(point) * 111.0
            if distance_km > 5:
                continue
            settlements.append({
                "name": name,
                "class": place_class,
                "lat": float(coords[1]),
                "lon": float(coords[0]),
                "distance_from_route_km": round(distance_km, 1),
                "route_order": round(line.project(point, normalized=True), 6),
                "population": props.get("population"),
            })
    except FileNotFoundError:
        pass
    settlements.sort(key=lambda item: item["route_order"])
    return {"streets": streets[:40], "settlements": settlements[:40]}
