"""Google Places (classic) + Geocoding helpers for Nigeria place search.

Uses the widely enabled Places API (legacy Text Search / Nearby Search).
Falls back gracefully when APIs are disabled; callers should use Nominatim.
"""

from __future__ import annotations

import logging
import math
import os
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACE_TEXT_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PLACE_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
TILE_SESSION_URL = "https://tile.googleapis.com/v1/createSession"

_http = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "GGISFloodWatch/1.0"})

# Cache Google Map Tiles sessions: map_type -> {session, expiry, style}
_tile_sessions: dict[str, dict[str, Any]] = {}


def google_enabled() -> bool:
    return bool(GOOGLE_MAPS_API_KEY)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _place_class_from_types(types: list[str] | None) -> str:
    t = set(types or [])
    if "locality" in t:
        return "City"
    if "administrative_area_level_2" in t or "administrative_area_level_1" in t:
        return "Town"
    if "sublocality" in t or "neighborhood" in t or "administrative_area_level_3" in t:
        return "Village"
    return "Town"


def _viewport_to_bbox_lnglat(geometry: dict | None) -> list[float] | None:
    if not geometry:
        return None
    viewport = geometry.get("viewport") or {}
    sw = viewport.get("southwest") or {}
    ne = viewport.get("northeast") or {}
    try:
        return [
            float(sw["lng"]),
            float(sw["lat"]),
            float(ne["lng"]),
            float(ne["lat"]),
        ]
    except (KeyError, TypeError, ValueError):
        return None


def _viewport_to_bbox_snswe(geometry: dict | None) -> list[float] | None:
    lnglat = _viewport_to_bbox_lnglat(geometry)
    if not lnglat:
        return None
    west, south, east, north = lnglat
    return [south, north, west, east]


async def search_places(q: str, limit: int = 5, country: str = "ng") -> list[dict[str, Any]] | None:
    """
    Prefer Places Text Search (works when Places API is enabled).
    Also try Geocoding if available.
    Returns None only when Google is disabled or both providers fail hard.
    """
    if not google_enabled():
        return None

    results: list[dict[str, Any]] = []

    # 1) Places Text Search (classic) — confirmed working with current key
    try:
        query = q if "nigeria" in q.lower() else f"{q}, Nigeria"
        resp = await _http.get(
            PLACE_TEXT_URL,
            params={
                "query": query,
                "region": country,
                "key": GOOGLE_MAPS_API_KEY,
            },
        )
        resp.raise_for_status()
        payload = resp.json()
        status = payload.get("status")
        if status in ("OK", "ZERO_RESULTS"):
            for r in (payload.get("results") or [])[:limit]:
                loc = (r.get("geometry") or {}).get("location") or {}
                if "lat" not in loc or "lng" not in loc:
                    continue
                name = (r.get("name") or "").strip() or (r.get("formatted_address") or "").split(",")[0]
                geom = r.get("geometry") or {}
                results.append(
                    {
                        "display_name": r.get("formatted_address") or name,
                        "name": name,
                        "lat": float(loc["lat"]),
                        "lon": float(loc["lng"]),
                        "type": (r.get("types") or ["locality"])[0],
                        "bbox": _viewport_to_bbox_snswe(geom),
                        "bbox_lnglat": _viewport_to_bbox_lnglat(geom),
                        "provider": "google",
                        "class": _place_class_from_types(r.get("types")),
                    }
                )
            return results
        log.warning("Google Places Text Search status=%s msg=%s", status, payload.get("error_message"))
    except Exception as exc:
        log.warning("Google Places Text Search failed: %s", exc)

    # 2) Geocoding API (if enabled on the project)
    try:
        resp = await _http.get(
            GEOCODE_URL,
            params={
                "address": q,
                "components": f"country:{country}",
                "region": country,
                "key": GOOGLE_MAPS_API_KEY,
            },
        )
        resp.raise_for_status()
        payload = resp.json()
        status = payload.get("status")
        if status in ("OK", "ZERO_RESULTS"):
            for r in (payload.get("results") or [])[:limit]:
                loc = (r.get("geometry") or {}).get("location") or {}
                formatted = r.get("formatted_address") or ""
                name = formatted.split(",")[0].strip() if formatted else "Place"
                comps = r.get("address_components") or []
                state = None
                for c in comps:
                    if "administrative_area_level_1" in (c.get("types") or []):
                        state = c.get("long_name")
                        break
                geom = r.get("geometry") or {}
                results.append(
                    {
                        "display_name": formatted or name,
                        "name": name,
                        "lat": float(loc["lat"]),
                        "lon": float(loc["lng"]),
                        "type": (r.get("types") or ["locality"])[0],
                        "bbox": _viewport_to_bbox_snswe(geom),
                        "bbox_lnglat": _viewport_to_bbox_lnglat(geom),
                        "provider": "google",
                        "state": state,
                    }
                )
            return results
        log.warning("Google Geocode search status=%s msg=%s", status, payload.get("error_message"))
    except Exception as exc:
        log.warning("Google Geocode search failed: %s", exc)

    return None


async def reverse_geocode(lat: float, lon: float) -> dict[str, Any] | None:
    """Reverse geocode via Geocoding API, or Nearby Search locality fallback."""
    if not google_enabled():
        return None

    # 1) Geocoding reverse (if enabled)
    try:
        resp = await _http.get(
            GEOCODE_URL,
            params={"latlng": f"{lat},{lon}", "key": GOOGLE_MAPS_API_KEY},
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") == "OK" and payload.get("results"):
            r = payload["results"][0]
            comps = r.get("address_components") or []
            name = None
            city = None
            state = None
            street = None
            house = None
            suburb = None
            for c in comps:
                types = c.get("types") or []
                long_name = c.get("long_name")
                if not name and (
                    "locality" in types
                    or "administrative_area_level_2" in types
                    or "sublocality" in types
                    or "neighborhood" in types
                ):
                    name = long_name
                if "locality" in types or "postal_town" in types:
                    city = long_name
                if "administrative_area_level_1" in types:
                    state = long_name
                if "route" in types:
                    street = long_name
                if "street_number" in types:
                    house = long_name
                if "sublocality" in types or "neighborhood" in types:
                    suburb = long_name
            display = r.get("formatted_address") or f"{name or 'Your location'}, Nigeria"
            name = name or city or state or "Your location"
            street_address = ", ".join(
                part
                for part in [
                    " ".join(p for p in [house, street] if p),
                    suburb,
                    city,
                    state,
                ]
                if part
            )
            geom = r.get("geometry") or {}
            types = r.get("types") or []
            return {
                "display_name": display,
                "street": street,
                "street_address": street_address or display,
                "name": name,
                "lat": lat,
                "lon": lon,
                "city": city,
                "state": state,
                "country": "Nigeria",
                "type": types[0] if types else "locality",
                "bbox": _viewport_to_bbox_snswe(geom),
                "bbox_lnglat": _viewport_to_bbox_lnglat(geom),
                "from_geolocation": True,
                "provider": "google",
            }
        log.warning(
            "Google reverse geocode status=%s msg=%s",
            payload.get("status"),
            payload.get("error_message"),
        )
    except Exception as exc:
        log.warning("Google reverse geocode failed: %s", exc)

    # 2) Nearby Search fallback (Places API) — pick nearest locality-like result
    try:
        for place_type in ("locality", "sublocality", "administrative_area_level_2"):
            resp = await _http.get(
                PLACE_NEARBY_URL,
                params={
                    "location": f"{lat},{lon}",
                    "rankby": "distance",
                    "type": place_type,
                    "key": GOOGLE_MAPS_API_KEY,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            rows = payload.get("results") or []
            if payload.get("status") != "OK" or not rows:
                continue
            r = rows[0]
            loc = (r.get("geometry") or {}).get("location") or {}
            name = (r.get("name") or "").strip() or "Your location"
            display = r.get("vicinity") or r.get("formatted_address") or f"{name}, Nigeria"
            return {
                "display_name": display if "Nigeria" in display else f"{display}, Nigeria",
                "street": None,
                "street_address": display,
                "name": name,
                "lat": float(loc.get("lat", lat)),
                "lon": float(loc.get("lng", lon)),
                "city": name,
                "state": None,
                "country": "Nigeria",
                "type": (r.get("types") or ["locality"])[0],
                "bbox": _viewport_to_bbox_snswe(r.get("geometry")),
                "bbox_lnglat": _viewport_to_bbox_lnglat(r.get("geometry")),
                "from_geolocation": True,
                "provider": "google",
            }
    except Exception as exc:
        log.warning("Google reverse nearby fallback failed: %s", exc)

    return None


async def nearby_settlements(
    lat: float,
    lon: float,
    radius_km: float = 25,
    limit: int = 8,
    exclude_name: str | None = None,
) -> list[dict[str, Any]] | None:
    """Classic Places Nearby Search for localities around a point."""
    if not google_enabled():
        return None

    exclude = (exclude_name or "").strip().lower()
    radius_m = max(500, min(int(radius_km * 1000), 50_000))
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()

    try:
        for place_type in ("locality", "sublocality", "administrative_area_level_3"):
            resp = await _http.get(
                PLACE_NEARBY_URL,
                params={
                    "location": f"{lat},{lon}",
                    "radius": radius_m,
                    "type": place_type,
                    "key": GOOGLE_MAPS_API_KEY,
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            status = payload.get("status")
            if status not in ("OK", "ZERO_RESULTS"):
                log.warning(
                    "Google Nearby Search type=%s status=%s msg=%s",
                    place_type,
                    status,
                    payload.get("error_message"),
                )
                continue
            for r in payload.get("results") or []:
                loc = (r.get("geometry") or {}).get("location") or {}
                if "lat" not in loc or "lng" not in loc:
                    continue
                name = (r.get("name") or "").strip()
                if not name or (exclude and name.lower() == exclude):
                    continue
                key = name.lower()
                if key in seen:
                    continue
                plat, plon = float(loc["lat"]), float(loc["lng"])
                distance = _haversine_km(lat, lon, plat, plon)
                if distance < 0.4 or distance > radius_km:
                    continue
                seen.add(key)
                collected.append(
                    {
                        "name": name,
                        "class": _place_class_from_types(r.get("types")),
                        "lat": plat,
                        "lon": plon,
                        "distance_km": round(distance, 1),
                        "population": None,
                        "display_name": r.get("vicinity") or f"{name}, Nigeria",
                        "source": "google",
                        "provider": "google",
                    }
                )

        # Top up with text search if sparse
        if len(collected) < max(3, limit // 2):
            resp = await _http.get(
                PLACE_TEXT_URL,
                params={
                    "query": "towns villages near here",
                    "location": f"{lat},{lon}",
                    "radius": radius_m,
                    "region": "ng",
                    "key": GOOGLE_MAPS_API_KEY,
                },
            )
            if resp.status_code < 400:
                payload = resp.json()
                for r in payload.get("results") or []:
                    loc = (r.get("geometry") or {}).get("location") or {}
                    if "lat" not in loc or "lng" not in loc:
                        continue
                    name = (r.get("name") or "").strip()
                    if not name or (exclude and name.lower() == exclude):
                        continue
                    key = name.lower()
                    if key in seen:
                        continue
                    plat, plon = float(loc["lat"]), float(loc["lng"])
                    distance = _haversine_km(lat, lon, plat, plon)
                    if distance < 0.4 or distance > radius_km:
                        continue
                    seen.add(key)
                    collected.append(
                        {
                            "name": name,
                            "class": _place_class_from_types(r.get("types")),
                            "lat": plat,
                            "lon": plon,
                            "distance_km": round(distance, 1),
                            "population": None,
                            "display_name": r.get("formatted_address") or f"{name}, Nigeria",
                            "source": "google",
                            "provider": "google",
                        }
                    )

        collected.sort(key=lambda row: row["distance_km"])
        return collected[:limit]
    except Exception as exc:
        log.warning("Google nearby settlements failed: %s", exc)
        return None


async def _ensure_tile_session(map_type: str) -> str | None:
    """Create or reuse a Map Tiles API session token for map_type."""
    if not google_enabled():
        return None

    map_type = map_type if map_type in ("roadmap", "satellite", "terrain") else "roadmap"
    cached = _tile_sessions.get(map_type)
    now = time.time()
    if cached and cached.get("session") and cached.get("expiry", 0) > now + 60:
        return cached["session"]

    body: dict[str, Any] = {
        "mapType": map_type,
        "language": "en-US",
        "region": "NG",
    }
    # terrain: optional roadmap overlay on terrain shading
    if map_type == "terrain":
        body["layerTypes"] = ["layerRoadmap"]
    # satellite: imagery only. Do NOT set layerTypes (roadmap) — that yields labels
    # without imagery. overlay=true adds road names on top of satellite (hybrid).
    if map_type == "satellite":
        body["overlay"] = True

    try:
        resp = await _http.post(
            f"{TILE_SESSION_URL}?key={GOOGLE_MAPS_API_KEY}",
            headers={"Content-Type": "application/json"},
            json=body,
        )
        if resp.status_code >= 400:
            log.warning(
                "Google Map Tiles session failed (%s): %s",
                resp.status_code,
                resp.text[:300],
            )
            return None
        payload = resp.json()
        session = payload.get("session")
        if not session:
            return None
        # Sessions typically last ~2 weeks; refresh a bit early.
        expiry = now + 7 * 24 * 3600
        _tile_sessions[map_type] = {"session": session, "expiry": expiry}
        return session
    except Exception as exc:
        log.warning("Google Map Tiles session failed: %s", exc)
        return None


async def google_maplibre_style(map_type: str = "roadmap", tile_url_template: str | None = None) -> dict[str, Any] | None:
    """
    Build a MapLibre style for Google Map Tiles.

    tile_url_template should be a same-origin (or API) proxy URL with {z}/{x}/{y}
    so the browser never sees the API key. Requires Map Tiles API enabled.
    """
    session = await _ensure_tile_session(map_type)
    if not session:
        return None

    map_type = map_type if map_type in ("roadmap", "satellite", "terrain") else "roadmap"
    if tile_url_template:
        tile_url = tile_url_template
    else:
        # Fallback (exposes key) — prefer proxy from the router.
        tile_url = (
            f"https://tile.googleapis.com/v1/2dtiles/{{z}}/{{x}}/{{y}}"
            f"?session={session}&key={GOOGLE_MAPS_API_KEY}"
        )

    return {
        "version": 8,
        "name": f"Google {map_type.title()}",
        # Needed so overlay symbol layers (places / admin labels) do not crash MapLibre
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        "sources": {
            "google": {
                "type": "raster",
                "tiles": [tile_url],
                "tileSize": 256,
                "attribution": "© Google",
                "maxzoom": 19,
            }
        },
        "layers": [
            {
                "id": "google-tiles",
                "type": "raster",
                "source": "google",
            }
        ],
    }


async def fetch_google_tile(map_type: str, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    """Fetch one Google Map tile via the server-side session (keeps API key off the client)."""
    session = await _ensure_tile_session(map_type)
    if not session:
        return None
    url = (
        f"https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}"
        f"?session={session}&key={GOOGLE_MAPS_API_KEY}"
    )
    try:
        resp = await _http.get(url)
        if resp.status_code >= 400:
            log.warning("Google tile %s/%s/%s failed: %s", z, x, y, resp.status_code)
            return None
        content_type = resp.headers.get("content-type", "image/png")
        return resp.content, content_type
    except Exception as exc:
        log.warning("Google tile fetch failed: %s", exc)
        return None
