"""
Fetch HydroBASINS Level 7 for Africa, clip to Nigeria, write simplified GeoJSON.

Source: HydroSHEDS / WWF HydroBASINS v1c (standard, Africa lev07)
  https://data.hydrosheds.org/file/hydrobasins/standard/hybas_af_lev07_v1c.zip

Output:
  api/data/basins.geojson

Requires: shapely, pyshp (pip install pyshp)

To re-clip an existing basins.geojson without re-downloading:
  python ingest/boundaries/fetch_hydrobasins.py --reclip-only
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]


def resolve_data_dir() -> Path:
    """Host repo api/data, or /api_data mount inside ingest container."""
    candidates = []
    if os.environ.get("BASINS_OUT_DIR"):
        candidates.append(Path(os.environ["BASINS_OUT_DIR"]))
    candidates.extend(
        [
            ROOT / "api" / "data",
            Path("/api_data"),
            Path(__file__).resolve().parents[1] / "data",
        ]
    )
    for path in candidates:
        if (path / "admin_states.geojson").exists():
            return path
    for path in candidates:
        if path.exists():
            return path
    path = candidates[0]
    path.mkdir(parents=True, exist_ok=True)
    return path


DATA_DIR = resolve_data_dir()
OUT_PATH = DATA_DIR / "basins.geojson"
STATES_PATH = DATA_DIR / "admin_states.geojson"

HYBAS_URL = "https://data.hydrosheds.org/file/hydrobasins/standard/hybas_af_lev07_v1c.zip"
# Nigeria approx bbox to prefilter before clip (slightly padded)
NGA_BBOX = (2.5, 4.0, 15.0, 14.0)  # minx, miny, maxx, maxy
SIMPLIFY_DEG = 0.008  # ~900 m
MIN_AREA_DEG2 = 1e-5  # drop tiny slivers after clip


def fetch_zip(url: str, dest: Path) -> None:
    print(f"Downloading {url} …")
    req = urllib.request.Request(url, headers={"User-Agent": "NigeriaFloodDashboard/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp, open(dest, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)
    print(f"  saved {dest.stat().st_size / 1e6:.1f} MB")


def nigeria_mask():
    """Strict national outline from admin_states — required for a true clip."""
    if not STATES_PATH.exists():
        raise SystemExit(
            f"Missing {STATES_PATH} — needed to clip basins to Nigeria. "
            "Run ingest/boundaries/fetch_admin_boundaries.py first."
        )
    data = json.loads(STATES_PATH.read_text(encoding="utf-8"))
    geoms = [shape(f["geometry"]) for f in data.get("features", []) if f.get("geometry")]
    if not geoms:
        raise SystemExit(f"No geometries in {STATES_PATH}")
    mask = unary_union(geoms)
    if not mask.is_valid:
        mask = mask.buffer(0)
    print(f"Nigeria mask bounds {tuple(round(x, 4) for x in mask.bounds)}")
    return mask


def as_polygons(geom):
    """Return Polygon or MultiPolygon, dropping non-area parts and tiny slivers."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.is_empty:
        return None

    polys = []
    if isinstance(geom, Polygon):
        polys = [geom]
    elif isinstance(geom, MultiPolygon):
        polys = list(geom.geoms)
    elif isinstance(geom, GeometryCollection):
        for part in geom.geoms:
            if isinstance(part, Polygon):
                polys.append(part)
            elif isinstance(part, MultiPolygon):
                polys.extend(part.geoms)
    else:
        return None

    polys = [p for p in polys if not p.is_empty and p.area >= MIN_AREA_DEG2]
    if not polys:
        return None
    if len(polys) == 1:
        return polys[0]
    return MultiPolygon(polys)


def clip_to_nigeria(geom, mask):
    try:
        clipped = geom.intersection(mask)
    except Exception:
        try:
            clipped = geom.buffer(0).intersection(mask.buffer(0))
        except Exception:
            return None
    return as_polygons(clipped)


def approx_area_km2(geom) -> float:
    """Rough geodesic-ish area from degree² (fine for display only)."""
    minx, miny, maxx, maxy = geom.bounds
    mid_lat = (miny + maxy) / 2.0
    # 1° lat ≈ 110.57 km; 1° lon ≈ 111.32 * cos(lat)
    import math
    km_per_deg_lat = 110.57
    km_per_deg_lon = 111.32 * math.cos(math.radians(mid_lat))
    return round(geom.area * km_per_deg_lat * km_per_deg_lon, 1)


def read_hybas_polygons(shp_path: Path):
    """Yield (props, shapely geom) for features intersecting Nigeria bbox."""
    try:
        import shapefile  # pyshp
    except ImportError as exc:
        raise SystemExit("pyshp is required: pip install pyshp\n" + str(exc)) from exc

    sf = shapefile.Reader(str(shp_path))
    fields = [f[0] for f in sf.fields[1:]]
    minx, miny, maxx, maxy = NGA_BBOX
    for sr in sf.iterShapeRecords():
        bbox = sr.shape.bbox  # [minx, miny, maxx, maxy]
        if bbox[2] < minx or bbox[0] > maxx or bbox[3] < miny or bbox[1] > maxy:
            continue
        props = dict(zip(fields, sr.record))
        geom = shape(sr.shape.__geo_interface__)
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        yield props, geom


def write_collection(features: list) -> None:
    collection = {
        "type": "FeatureCollection",
        "meta": {
            "source": "HydroBASINS v1c Level 7 (Africa), clipped to Nigeria admin boundary",
            "attribution": "HydroSHEDS / WWF (CC BY 4.0)",
            "level": 7,
            "feature_count": len(features),
        },
        "features": features,
    }
    OUT_PATH.write_text(json.dumps(collection), encoding="utf-8")
    print(f"Wrote {len(features)} basins -> {OUT_PATH} ({OUT_PATH.stat().st_size / 1e6:.1f} MB)")


def feature_from_props_geom(props: dict, geom) -> dict:
    basin_id = int(props.get("HYBAS_ID") or props.get("hybas_id") or props.get("basin_id") or 0)
    next_down = props.get("NEXT_DOWN") or props.get("next_down")
    return {
        "type": "Feature",
        "properties": {
            "basin_id": basin_id,
            "name": props.get("name") or f"Basin {basin_id}",
            "next_down": int(next_down) if next_down not in (None, "") else None,
            "area_km2": approx_area_km2(geom),
            "pfaf_id": props.get("PFAF_ID") or props.get("pfaf_id"),
        },
        "geometry": mapping(geom),
    }


def reclip_existing(mask) -> None:
    if not OUT_PATH.exists():
        raise SystemExit(f"No existing {OUT_PATH} to reclip")
    print(f"Reclipping {OUT_PATH} …")
    data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    features = []
    for f in data.get("features") or []:
        geom = shape(f["geometry"]) if f.get("geometry") else None
        if geom is None:
            continue
        clipped = clip_to_nigeria(geom, mask)
        if clipped is None:
            continue
        try:
            clipped = clipped.simplify(SIMPLIFY_DEG, preserve_topology=True)
        except Exception:
            pass
        clipped = as_polygons(clipped)
        if clipped is None:
            continue
        props = dict(f.get("properties") or {})
        features.append(feature_from_props_geom(props, clipped))
    write_collection(features)


def fetch_and_clip(mask) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "hybas_af_lev07_v1c.zip"
        fetch_zip(HYBAS_URL, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)
        shp_candidates = list(tmp_path.rglob("hybas_af_lev07_v1c.shp"))
        if not shp_candidates:
            shp_candidates = list(tmp_path.rglob("*lev07*.shp"))
        if not shp_candidates:
            raise SystemExit("Could not find HydroBASINS lev07 shapefile in zip")
        shp_path = shp_candidates[0]
        print(f"Reading {shp_path.name} …")

        features = []
        for props, geom in read_hybas_polygons(shp_path):
            clipped = clip_to_nigeria(geom, mask)
            if clipped is None:
                continue
            try:
                clipped = clipped.simplify(SIMPLIFY_DEG, preserve_topology=True)
            except Exception:
                pass
            clipped = as_polygons(clipped)
            if clipped is None:
                continue
            features.append(feature_from_props_geom(props, clipped))

    write_collection(features)


def main():
    parser = argparse.ArgumentParser(description="Fetch/clip HydroBASINS L7 to Nigeria")
    parser.add_argument(
        "--reclip-only",
        action="store_true",
        help="Re-clip existing basins.geojson against admin_states (no download)",
    )
    args = parser.parse_args()
    mask = nigeria_mask()
    if args.reclip_only:
        reclip_existing(mask)
    else:
        fetch_and_clip(mask)


if __name__ == "__main__":
    main()
