"""
Fetch Nigeria exposure layers from OpenStreetMap via Overpass and write GeoJSON.

Outputs:
  api/data/exposure_roads.geojson
  api/data/exposure_bridges.geojson
  api/data/exposure_places.geojson
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "api" / "data"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

ROAD_QUERY = """
[out:json][timeout:240];
area["ISO3166-1"="NG"][admin_level=2]->.searchArea;
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary"](area.searchArea);
);
out ids tags geom;
"""

BRIDGE_QUERY = """
[out:json][timeout:240];
area["ISO3166-1"="NG"][admin_level=2]->.searchArea;
(
  node["bridge"="yes"]["highway"](area.searchArea);
  way["bridge"="yes"]["highway"](area.searchArea);
);
out center tags;
"""

PLACES_QUERY = """
[out:json][timeout:240];
area["ISO3166-1"="NG"][admin_level=2]->.searchArea;
(
  node["place"~"city|town|village"](area.searchArea);
  way["place"~"city|town|village"](area.searchArea);
  relation["place"~"city|town|village"](area.searchArea);
);
out center tags;
"""

ROAD_CLASS_MAP = {
    "motorway": "Highway",
    "trunk": "Highway",
    "primary": "Major Road",
    "secondary": "Secondary Road",
    "tertiary": "Tertiary Road",
}

PLACE_CLASS_MAP = {
    "city": "City",
    "town": "Town",
    "village": "Village",
}


def fetch_overpass(query: str) -> dict:
    encoded = urllib.parse.quote(query, safe="")
    last_error = None
    for base_url in OVERPASS_URLS:
        request = urllib.request.Request(
            f"{base_url}?data={encoded}",
            headers={
                "User-Agent": "NigeriaFloodDashboard/1.0",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response)
        except Exception as exc:  # pragma: no cover - network fallback
            last_error = exc
    raise last_error


def rounded(value: float, precision: int = 5) -> float:
    return round(value, precision)


def simplify_coords(coords: list[list[float]], precision: int = 5) -> list[list[float]]:
    simplified: list[list[float]] = []
    previous: tuple[float, float] | None = None
    for lon, lat in coords:
        pair = (rounded(lon, precision), rounded(lat, precision))
        if pair != previous:
            simplified.append([pair[0], pair[1]])
            previous = pair
    return simplified


def road_properties(tags: dict) -> dict | None:
    highway = tags.get("highway")
    road_class = ROAD_CLASS_MAP.get(highway)
    if not road_class:
        return None
    return {
        "class": road_class,
        "highway": highway,
        "name": tags.get("name"),
        "ref": tags.get("ref"),
        "surface": tags.get("surface"),
        "lanes": tags.get("lanes"),
        "bridge": tags.get("bridge") == "yes",
    }


def build_roads(elements: list[dict]) -> dict:
    features = []
    for element in elements:
        if element.get("type") != "way":
            continue
        tags = element.get("tags") or {}
        props = road_properties(tags)
        geometry = element.get("geometry") or []
        if not props or len(geometry) < 2:
            continue

        coords = simplify_coords([[node["lon"], node["lat"]] for node in geometry])
        if len(coords) < 2:
            continue

        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"osm_id": element["id"], **props},
        })

    return {"type": "FeatureCollection", "features": features}


def build_bridges(elements: list[dict]) -> dict:
    features = []
    seen: set[tuple[float, float, str]] = set()
    for element in elements:
        tags = element.get("tags") or {}
        highway = tags.get("highway")
        if not highway:
            continue

        if element.get("type") == "node":
            lat = element.get("lat")
            lon = element.get("lon")
        else:
            center = element.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is None or lon is None:
            continue

        bridge_class = ROAD_CLASS_MAP.get(highway, "Road Bridge")
        key = (rounded(lon), rounded(lat), bridge_class)
        if key in seen:
            continue
        seen.add(key)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [rounded(lon), rounded(lat)]},
            "properties": {
                "osm_id": element["id"],
                "class": bridge_class,
                "highway": highway,
                "name": tags.get("name"),
                "ref": tags.get("ref"),
                "layer": tags.get("layer"),
            },
        })

    return {"type": "FeatureCollection", "features": features}


def place_rank(place_class: str) -> int:
    return {"City": 3, "Town": 2, "Village": 1}.get(place_class, 0)


def build_places(elements: list[dict]) -> dict:
    features = []
    seen: set[tuple[str, float, float]] = set()
    for element in elements:
        tags = element.get("tags") or {}
        place = tags.get("place")
        place_class = PLACE_CLASS_MAP.get(place)
        if not place_class:
            continue

        if element.get("type") == "node":
            lat = element.get("lat")
            lon = element.get("lon")
        else:
            center = element.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is None or lon is None:
            continue

        name = tags.get("name")
        if not name:
            continue

        lon = rounded(lon)
        lat = rounded(lat)
        key = (name.lower(), lon, lat)
        if key in seen:
            continue
        seen.add(key)

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "osm_id": element["id"],
                "name": name,
                "class": place_class,
                "place": place,
                "population": tags.get("population"),
                "capital": tags.get("capital"),
                "rank": place_rank(place_class),
            },
        })

    features.sort(
        key=lambda feature: (
            -int(feature["properties"]["rank"]),
            -(int(feature["properties"]["population"]) if str(feature["properties"]["population"]).isdigit() else 0),
            feature["properties"]["name"],
        )
    )
    return {"type": "FeatureCollection", "features": features}


def write_geojson(filename: str, data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / filename
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {path} with {len(data['features'])} features")


def main() -> None:
    roads = build_roads(fetch_overpass(ROAD_QUERY)["elements"])
    bridges = build_bridges(fetch_overpass(BRIDGE_QUERY)["elements"])
    places = build_places(fetch_overpass(PLACES_QUERY)["elements"])

    write_geojson("exposure_roads.geojson", roads)
    write_geojson("exposure_bridges.geojson", bridges)
    write_geojson("exposure_places.geojson", places)


if __name__ == "__main__":
    main()
