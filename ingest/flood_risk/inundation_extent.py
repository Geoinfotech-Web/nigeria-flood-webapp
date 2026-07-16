"""
SAR + DEM inundation extents — Very High / High / Moderate
==========================================================
Builds a three-class inundation product for Nigeria:

  Very High (3) = Sentinel-1 SAR flood change-detection
                  ∩ slope < 5° ∩ not permanent water
  High (2)      = DEM floodplain (stronger):
                  slope < 2° ∩ elev within ~10 m of local drainage
                  ∩ JRC occurrence 5–80% ∩ not Very High
                  ∩ not permanent water
  Moderate (1)  = DEM floodplain (broader):
                  slope < 2° ∩ elev within ~15 m of local drainage
                  ∩ JRC occurrence 5–80% ∩ not Very High / High
                  ∩ not permanent water

Exports:
  a. Classified Uint8 COG → MinIO → TiTiler (`source=sar_dem_inundation`)
  b. Simplified MultiPolygon extents → flood_risk_areas
     (`risk_tier` ∈ {Moderate, High, Very High}, `source=sar_dem_inundation`)

Run:
  DB_HOST=localhost GEE_SERVICE_ACCOUNT_EMAIL=... GEE_SERVICE_ACCOUNT_KEY=... \\
    python ingest/flood_risk/inundation_extent.py
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
import tempfile
import urllib.request
from datetime import date, timedelta
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [inundation] %(message)s",
    force=True,
)
log = logging.getLogger(__name__)

GEE_KEY_FILE = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_KEY = os.getenv("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET = "flood-risk-tiles"
SOURCE = "sar_dem_inundation"

NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

TIER_META = {
    1: {"tier": "Moderate", "score": 0.4},
    2: {"tier": "High", "score": 0.65},
    3: {"tier": "Very High", "score": 0.9},
}


def init_gee() -> bool:
    try:
        import ee
    except ImportError:
        log.error("earthengine-api not installed: pip install earthengine-api")
        return False
    try:
        if GEE_KEY_FILE and Path(GEE_KEY_FILE).exists():
            creds = ee.ServiceAccountCredentials(GEE_SA_EMAIL, GEE_KEY_FILE)
            ee.Initialize(creds)
            log.info("GEE initialised with service account")
        else:
            ee.Initialize()
            log.info("GEE initialised with default credentials")
        return True
    except Exception as exc:
        log.error("GEE init failed: %s", exc)
        return False


def get_nigeria_geometry():
    import ee

    try:
        countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
        return countries.filter(ee.Filter.eq("country_na", "Nigeria")).geometry()
    except Exception:
        return ee.Geometry.BBox(*NIGERIA_BBOX)


def build_inundation_classes(days_back: int = 10):
    """
    Return (classified Uint8 image, nigeria geometry).
    Values: 0=dry/masked, 1=Moderate, 2=High, 3=Very High.
    """
    import ee

    today = date.today()
    t_start = (today - timedelta(days=days_back)).isoformat()
    t_end = today.isoformat()
    nigeria = get_nigeria_geometry()

    s1 = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING"))
        .filterBounds(nigeria)
        .select("VV")
    )

    current = s1.filterDate(t_start, t_end).median().clip(nigeria)
    baseline_start = (today - timedelta(days=730)).isoformat()
    baseline_end = (today - timedelta(days=30)).isoformat()
    baseline = s1.filterDate(baseline_start, baseline_end)
    baseline_mean = baseline.mean().clip(nigeria)
    baseline_std = baseline.reduce(ee.Reducer.stdDev()).clip(nigeria)
    threshold = baseline_mean.subtract(baseline_std.multiply(1.5))
    flood_raw = current.lt(threshold)

    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(nigeria)
    slope = ee.Terrain.slope(srtm)
    # Local drainage proxy: elevation above focal minimum (≈ HAND-lite)
    focal_min = srtm.focal_min(radius=1000, units="meters", kernelType="circle")
    height_above_drain = srtm.subtract(focal_min)

    jrc = (
        ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
        .select("occurrence")
        .unmask(0)
        .clip(nigeria)
    )
    not_perm = jrc.lt(80)
    seasonal_or_floodplain = jrc.gte(5).And(jrc.lt(80))

    very_high = flood_raw.And(slope.lt(5)).And(not_perm).rename("very_high")
    high = (
        slope.lt(2)
        .And(height_above_drain.lte(10))
        .And(seasonal_or_floodplain)
        .And(not_perm)
        .And(very_high.Not())
        .rename("high")
    )
    moderate = (
        slope.lt(2)
        .And(height_above_drain.lte(15))
        .And(seasonal_or_floodplain)
        .And(not_perm)
        .And(very_high.Not())
        .And(high.Not())
        .rename("moderate")
    )

    classified = (
        ee.Image(0)
        .where(moderate, 1)
        .where(high, 2)
        .where(very_high, 3)
        .updateMask(ee.Image(1).clip(nigeria))
        .clip(nigeria)
        .rename("inundation_class")
        .toUint8()
    )

    log.info(
        "Inundation classes built (%s → %s): 1=Moderate, 2=High, 3=Very High",
        t_start,
        t_end,
    )
    return classified, nigeria


def _to_cog(src: str, dst: str):
    try:
        import rasterio
        from rasterio.shutil import copy as rio_copy

        with rasterio.open(src) as s:
            rio_copy(
                s,
                dst,
                driver="GTiff",
                tiled=True,
                blockxsize=512,
                blockysize=512,
                compress="deflate",
            )
        log.info("COG created: %s", dst)
    except ImportError:
        shutil.copy(src, dst)


def export_to_minio(image, filename: str, scale_m: int = 500):
    """
    Tiled GEE download → mosaic COG → MinIO.
    Returns (minio_path | None, local_cog_path | None).
    """
    import ee
    import boto3
    from botocore.client import Config

    log.info("Exporting inundation classes at %dm via tiled download…", scale_m)
    image_filled = image.unmask(0)

    w, s, e, n = NIGERIA_BBOX
    lon_splits = [w, w + (e - w) / 3, w + 2 * (e - w) / 3, e]
    lat_splits = [s, s + (n - s) / 2, n]

    tiles = []
    local_cog = Path(tempfile.gettempdir()) / filename

    with tempfile.TemporaryDirectory() as tmpdir:
        for i, (x0, x1) in enumerate(zip(lon_splits, lon_splits[1:])):
            for j, (y0, y1) in enumerate(zip(lat_splits, lat_splits[1:])):
                tile_region = ee.Geometry.BBox(x0, y0, x1, y1)
                tile_file = os.path.join(tmpdir, f"tile_{i}_{j}.tif")
                try:
                    url = image_filled.getDownloadURL(
                        {
                            "region": tile_region,
                            "scale": scale_m,
                            "crs": "EPSG:4326",
                            "format": "GEO_TIFF",
                        }
                    )
                    urllib.request.urlretrieve(url, tile_file)
                    tiles.append(tile_file)
                    log.info(
                        "  Tile [%d,%d] downloaded (%.1f MB)",
                        i,
                        j,
                        Path(tile_file).stat().st_size / 1e6,
                    )
                except Exception as exc:
                    log.warning("  Tile [%d,%d] failed: %s", i, j, exc)

        if not tiles:
            log.error("All tiles failed — skipping raster export")
            return None, None

        merged_path = os.path.join(tmpdir, "merged.tif")
        cog_path = os.path.join(tmpdir, "merged_cog.tif")
        try:
            import rasterio
            from rasterio.merge import merge as rio_merge

            datasets = [rasterio.open(t) for t in tiles]
            mosaic, transform = rio_merge(datasets)
            profile = datasets[0].profile.copy()
            profile.update(
                {
                    "width": mosaic.shape[2],
                    "height": mosaic.shape[1],
                    "transform": transform,
                    "dtype": mosaic.dtype,
                    "count": mosaic.shape[0],
                }
            )
            with rasterio.open(merged_path, "w", **profile) as dst:
                dst.write(mosaic)
            for ds in datasets:
                ds.close()
            _to_cog(merged_path, cog_path)
            shutil.copy(cog_path, local_cog)
            log.info("Mosaic COG ready: %s", local_cog)
        except Exception as exc:
            log.warning("Mosaic failed (%s) — using first tile", exc)
            shutil.copy(tiles[0], local_cog)

        try:
            s3 = boto3.client(
                "s3",
                endpoint_url=MINIO_ENDPOINT,
                aws_access_key_id=MINIO_KEY,
                aws_secret_access_key=MINIO_SECRET,
                config=Config(signature_version="s3v4"),
            )
            try:
                s3.create_bucket(Bucket=MINIO_BUCKET)
            except Exception:
                pass
            s3.upload_file(
                str(local_cog),
                MINIO_BUCKET,
                filename,
                ExtraArgs={"ContentType": "image/tiff"},
            )
            log.info("Uploaded %s to MinIO", filename)
            return f"s3://{MINIO_BUCKET}/{filename}", str(local_cog)
        except Exception as exc:
            log.error("MinIO upload failed: %s", exc)
            return None, str(local_cog) if local_cog.exists() else None


def polygonize_classes(cog_path: str) -> list[dict]:
    """Convert class raster to simplified MultiPolygon features."""
    import numpy as np
    import rasterio
    from rasterio import features as rio_features
    from shapely.geometry import MultiPolygon, Polygon, mapping, shape
    from shapely.ops import unary_union

    features_out = []
    with rasterio.open(cog_path) as src:
        band = src.read(1)
        transform = src.transform
        for class_val, meta in TIER_META.items():
            mask = (band == class_val).astype(np.uint8)
            if not mask.any():
                log.info("No pixels for class %s (%s)", class_val, meta["tier"])
                continue
            shapes = list(
                rio_features.shapes(mask, mask=mask.astype(bool), transform=transform)
            )
            geoms = []
            for geom, val in shapes:
                if int(val) != 1:
                    continue
                g = shape(geom)
                if not g.is_valid:
                    g = g.buffer(0)
                # ~1e-4 deg² ≈ 1 km² near equator
                if g.area < 1e-4:
                    continue
                geoms.append(g)
            if not geoms:
                continue
            merged = unary_union(geoms)
            parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
            parts = sorted(parts, key=lambda g: g.area, reverse=True)[:80]
            for idx, part in enumerate(parts, start=1):
                simplified = part.simplify(0.01, preserve_topology=True)
                if simplified.is_empty:
                    continue
                if isinstance(simplified, Polygon):
                    mp = MultiPolygon([simplified])
                elif isinstance(simplified, MultiPolygon):
                    mp = simplified
                else:
                    continue
                features_out.append(
                    {
                        "name": f"{meta['tier']} zone {idx}",
                        "tier": meta["tier"],
                        "score": meta["score"],
                        "geometry": mapping(mp),
                    }
                )
            log.info(
                "Polygonized %s → %d zones",
                meta["tier"],
                sum(1 for f in features_out if f["tier"] == meta["tier"]),
            )
    return features_out


def _multipolygon_to_wkt(geom: dict) -> str:
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        coords = [coords]
    rings = []
    for poly in coords:
        for ring in poly:
            pts = ", ".join(f"{x} {y}" for x, y in ring)
            rings.append(f"(({pts}))")
    return "MULTIPOLYGON(" + ",".join(rings) + ")"


def save_to_db(
    minio_path: str | None,
    features: list[dict],
    valid_from: date,
    valid_to: date,
):
    import psycopg2

    titiler_base = os.getenv("TITILER_URL", "http://localhost:8888")
    tile_url = (
        f"{titiler_base}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png"
        f"?url={minio_path}"
        if minio_path
        else None
    )

    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            if minio_path:
                cur.execute(
                    "DELETE FROM flood_risk_tiles WHERE source = %s", (SOURCE,)
                )
                cur.execute(
                    """
                    INSERT INTO flood_risk_tiles
                      (source, label, minio_path, tile_url, valid_from, valid_to)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        SOURCE,
                        f"SAR/DEM Inundation {valid_from}",
                        minio_path,
                        tile_url,
                        valid_from,
                        valid_to,
                    ),
                )

            cur.execute(
                "DELETE FROM flood_risk_areas WHERE source = %s", (SOURCE,)
            )
            # Drop old SAR state-box rows so they no longer appear as risk areas
            cur.execute(
                "DELETE FROM flood_risk_areas WHERE source = 'sentinel1'"
            )

            for feat in features:
                wkt = _multipolygon_to_wkt(feat["geometry"])
                cur.execute(
                    """
                    INSERT INTO flood_risk_areas
                      (name, admin_level, state, geom, risk_score, risk_tier,
                       source, valid_from, valid_to, updated_at)
                    VALUES (%s, 'inundation', NULL,
                            ST_GeomFromText(%s, 4326),
                            %s, %s, %s, %s, %s, NOW())
                    """,
                    (
                        feat["name"],
                        wkt,
                        feat["score"],
                        feat["tier"],
                        SOURCE,
                        valid_from,
                        valid_to,
                    ),
                )
        conn.commit()
    finally:
        conn.close()

    log.info(
        "Saved %d inundation polygons + tile=%s",
        len(features),
        bool(minio_path),
    )


def run(days_back: int = 10, scale_m: int = 500):
    today = date.today()
    valid_from = today
    valid_to = today + timedelta(days=14)
    filename = f"nigeria_sar_dem_inundation_{today}.tif"

    if not init_gee():
        log.error("GEE not available — cannot build inundation product")
        sys.exit(1)

    classified, _nigeria = build_inundation_classes(days_back=days_back)
    minio_path, local_cog = export_to_minio(classified, filename, scale_m=scale_m)
    if not minio_path and not local_cog:
        log.error("Export failed")
        sys.exit(1)

    features: list[dict] = []
    if local_cog and Path(local_cog).exists():
        try:
            features = polygonize_classes(local_cog)
        except Exception as exc:
            log.error("Polygonize failed: %s", exc, exc_info=True)
        finally:
            try:
                Path(local_cog).unlink(missing_ok=True)
            except Exception:
                pass
    else:
        log.warning("No local COG for polygonize — tiles only")

    save_to_db(minio_path, features, valid_from, valid_to)
    log.info(
        "Inundation product complete — %d polygons, tile=%s",
        len(features),
        minio_path,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="SAR+DEM Very High / High / Moderate inundation for Nigeria"
    )
    parser.add_argument("--days-back", type=int, default=10)
    parser.add_argument("--scale-m", type=int, default=500)
    args = parser.parse_args()
    run(days_back=args.days_back, scale_m=args.scale_m)
