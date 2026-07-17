"""
Google Earth Engine flood-risk ingest.

Exports two Nigeria-wide rasters clipped to the actual country geometry:
  1. Inundation History (3 wet classes) — JRC GSW Landsat occurrence 1984–2021
  2. Classified flood susceptibility (1-4: Low -> Highly Susceptible)
     based on JRC occurrence + HAND + distance to drainage + slope

Both are converted to COGs, uploaded to MinIO, and registered in
`flood_risk_tiles` for serving through the API tile proxy.
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import tempfile
import urllib.request
from datetime import date, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [gee] %(message)s", force=True)
log = logging.getLogger(__name__)

GEE_KEY_FILE = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_KEY = os.getenv("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET = "flood-risk-tiles"

NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]

# ── Susceptibility factor model ───────────────────────────────────────────────
# score = 0.40*JRC + 0.30*HAND + 0.20*distance-to-drainage + 0.10*slope
SUS_W_JRC = 0.40
SUS_W_HAND = 0.30
SUS_W_DIST = 0.20
SUS_W_SLOPE = 0.10
# HAND above this (m) contributes zero susceptibility
HAND_MAX_M = 30.0
# Drainage cells: HAND-lite at or below this (m)
DRAIN_HAND_M = 3.0
# Distance beyond this (m) from drainage contributes zero susceptibility
DIST_MAX_M = 5000.0
SLOPE_MAX_DEG = 30.0

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

HISTORY_SOURCE = "inundation_history"
HISTORY_TIER_META = {
    1: {"tier": "Occasional", "score": 0.15, "name_prefix": "Occasional"},
    2: {"tier": "Frequent", "score": 0.375, "name_prefix": "Frequent"},
    3: {"tier": "Very frequent", "score": 0.75, "name_prefix": "Very frequent"},
}

SOURCE_DEFS = {
    "jrc_occurrence": {
        "filename": "nigeria_inundation_history_classes_{valid_from}_{mode}.tif",
        "label": "Inundation History",
        "tiled_export": True,
        "scale_m_monthly": 250,
        "scale_m_weekly": 250,
    },
    "gee_susceptibility_classes": {
        "filename": "nigeria_flood_susceptibility_classes_{valid_from}_{mode}.tif",
        "label": "Flood Susceptibility",
        "tiled_export": False,
        "scale_m_monthly": 1000,
        "scale_m_weekly": 500,
    },
}


def init_gee() -> bool:
    """Initialise GEE. Returns True if successful."""
    try:
        import ee
    except ImportError:
        log.error("earthengine-api not installed: pip install earthengine-api")
        return False

    try:
        if GEE_KEY_FILE and Path(GEE_KEY_FILE).exists():
            credentials = ee.ServiceAccountCredentials(GEE_SA_EMAIL, GEE_KEY_FILE)
            ee.Initialize(credentials)
            log.info("GEE initialised with service account")
        else:
            ee.Initialize()
            log.info("GEE initialised with default credentials")
        return True
    except Exception as exc:
        log.error("GEE init failed: %s", exc)
        return False


def get_nigeria_geometry():
    """Return a country-accurate Nigeria geometry from a public GEE boundary dataset."""
    import ee

    try:
        countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
        return countries.filter(ee.Filter.eq("country_na", "Nigeria")).geometry()
    except Exception:
        return ee.Geometry.BBox(*NIGERIA_BBOX)


def build_layers():
    """Build 3-class inundation history (JRC Landsat) + 4-class susceptibility."""
    import ee

    nigeria = get_nigeria_geometry()

    jrc_raw = (
        ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
        .select("occurrence")
        .unmask(0)
        .clip(nigeria)
    )

    log.info("Inundation history: JRC GSW Landsat occurrence 1984–2021")

    # Occasional 5–25% / Frequent 25–50% / Very frequent >50%
    inundation_history = (
        ee.Image(0)
        .where(jrc_raw.gte(5).And(jrc_raw.lt(25)), 1)   # occasional
        .where(jrc_raw.gte(25).And(jrc_raw.lt(50)), 2)  # frequent
        .where(jrc_raw.gte(50), 3)                       # very frequent
        .updateMask(jrc_raw.gte(5))
        .clip(nigeria)
        .rename("inundation_history")
        .toUint8()
    )

    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(nigeria)
    slope = ee.Terrain.slope(srtm)

    # HAND-lite: elevation above 1 km focal minimum (same proxy as inundation)
    focal_min = srtm.focal_min(radius=1000, units="meters", kernelType="circle")
    hand = srtm.subtract(focal_min).max(0).rename("hand")
    hand_sus = (
        ee.Image(1)
        .subtract(hand.divide(HAND_MAX_M).clamp(0, 1))
        .multiply(100)
    )

    # Drainage = permanent/seasonal water (JRC ≥ 5%) or valley floors (low HAND)
    drainage = jrc_raw.gte(5).Or(hand.lte(DRAIN_HAND_M)).selfMask()
    dist_m = (
        drainage.fastDistanceTransform(1024)
        .sqrt()
        .multiply(ee.Image.pixelArea().sqrt())
        .rename("dist_to_drainage")
    )
    dist_sus = (
        ee.Image(1)
        .subtract(dist_m.divide(DIST_MAX_M).clamp(0, 1))
        .multiply(100)
    )

    slope_sus = (
        ee.Image(1)
        .subtract(slope.divide(SLOPE_MAX_DEG).clamp(0, 1))
        .multiply(100)
    )

    log.info(
        "Susceptibility factors: JRC %.0f%% + HAND %.0f%% (max %.0f m) "
        "+ distance-to-drainage %.0f%% (max %.0f m) + slope %.0f%%",
        SUS_W_JRC * 100,
        SUS_W_HAND * 100,
        HAND_MAX_M,
        SUS_W_DIST * 100,
        DIST_MAX_M,
        SUS_W_SLOPE * 100,
    )

    susceptibility = (
        jrc_raw.multiply(SUS_W_JRC)
        .add(hand_sus.multiply(SUS_W_HAND))
        .add(dist_sus.multiply(SUS_W_DIST))
        .add(slope_sus.multiply(SUS_W_SLOPE))
    ).rename("flood_susceptibility").clamp(0, 100).clip(nigeria)

    susceptibility_classes = (
        ee.Image(1)
        .where(susceptibility.gt(25), 2)
        .where(susceptibility.gt(50), 3)
        .where(susceptibility.gt(75), 4)
        .updateMask(susceptibility.mask())
        .rename("flood_susceptibility_class")
        .clip(nigeria)
        .toUint8()
    )

    return {
        "jrc_occurrence": inundation_history,
        "gee_susceptibility_classes": susceptibility_classes,
    }, nigeria


def _to_cog(src_path: str, dst_path: str):
    """Convert GeoTIFF to Cloud Optimized GeoTIFF using rasterio when available."""
    try:
        import rasterio
        from rasterio.shutil import copy as rio_copy

        with rasterio.open(src_path) as src:
            rio_copy(
                src,
                dst_path,
                driver="GTiff",
                copy_src_overwrite=True,
                tiled=True,
                blockxsize=512,
                blockysize=512,
                compress="deflate",
                overviews="AUTO",
            )
        log.info("COG created: %s", dst_path)
    except ImportError:
        shutil.copy(src_path, dst_path)
        log.warning("rasterio not installed; uploaded original GeoTIFF")


def _upload_cog(local_path: str, filename: str) -> str | None:
    import boto3
    from botocore.client import Config

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
            local_path,
            MINIO_BUCKET,
            filename,
            ExtraArgs={"ContentType": "image/tiff"},
        )
        log.info("Uploaded %s to bucket %s", filename, MINIO_BUCKET)
        return f"s3://{MINIO_BUCKET}/{filename}"
    except Exception as exc:
        log.error("MinIO upload failed for %s: %s", filename, exc)
        return None


def export_to_minio_single(image, region, filename: str, scale_m: int) -> str | None:
    """Single-shot GEE download → COG → MinIO."""
    log.info("Downloading %s at %dm resolution (single-shot)", filename, scale_m)

    try:
        url = image.getDownloadURL({
            "region": region,
            "scale": scale_m,
            "crs": "EPSG:4326",
            "format": "GEO_TIFF",
        })
    except Exception as exc:
        log.error("GEE getDownloadURL failed for %s: %s", filename, exc)
        return None

    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp_path = tmp.name
    cog_path = tmp_path.replace(".tif", "_cog.tif")

    try:
        urllib.request.urlretrieve(url, tmp_path)
        log.info("Downloaded %.1f MB for %s", Path(tmp_path).stat().st_size / 1e6, filename)
        _to_cog(tmp_path, cog_path)
        return _upload_cog(cog_path, filename)
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        Path(cog_path).unlink(missing_ok=True)


def export_to_minio_tiled(
    image, filename: str, scale_m: int, keep_local: bool = False
) -> tuple[str | None, str | None]:
    """
    Tiled GEE download → mosaic COG → MinIO.
    Returns (minio_path, local_cog_path|None).
    """
    import ee

    log.info("Exporting %s at %dm via tiled download…", filename, scale_m)
    image_filled = image.unmask(0)

    w, s, e, n = NIGERIA_BBOX
    lon_splits = [w, w + (e - w) / 3, w + 2 * (e - w) / 3, e]
    lat_splits = [s, s + (n - s) / 2, n]

    local_keep: Path | None = None
    if keep_local:
        local_keep = Path(tempfile.gettempdir()) / filename

    with tempfile.TemporaryDirectory() as tmpdir:
        tiles = []
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
            log.error("All tiles failed for %s", filename)
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
        except Exception as exc:
            log.warning("Mosaic failed (%s) — using first tile", exc)
            shutil.copy(tiles[0], cog_path)

        if local_keep is not None:
            shutil.copy(cog_path, local_keep)

        minio_path = _upload_cog(cog_path, filename)
        return minio_path, str(local_keep) if local_keep and local_keep.exists() else None


def export_to_minio(
    image,
    region,
    filename: str,
    scale_m: int,
    tiled: bool = False,
    keep_local: bool = False,
) -> tuple[str | None, str | None]:
    """Export image; returns (minio_path, local_path|None)."""
    if tiled:
        path, local = export_to_minio_tiled(
            image, filename, scale_m, keep_local=keep_local
        )
        if path:
            return path, local
        log.warning("Tiled export failed for %s — trying single-shot", filename)

    path = export_to_minio_single(image, region, filename, scale_m)
    # single-shot does not keep local copy
    if path:
        return path, None

    if not tiled:
        log.warning("Single-shot failed for %s — falling back to tiled export", filename)
        return export_to_minio_tiled(image, filename, scale_m, keep_local=keep_local)
    return None, None


def polygonize_history(cog_path: str) -> list[dict]:
    """Convert 3-class history raster to simplified MultiPolygon features."""
    import numpy as np
    import rasterio
    from rasterio import features as rio_features
    from shapely.geometry import MultiPolygon, Polygon, mapping, shape
    from shapely.ops import unary_union

    features_out = []
    with rasterio.open(cog_path) as src:
        band = src.read(1)
        transform = src.transform
        for class_val, meta in HISTORY_TIER_META.items():
            mask = (band == class_val).astype(np.uint8)
            if not mask.any():
                log.info("No history pixels for class %s (%s)", class_val, meta["tier"])
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
                # ~2.5e-5 deg² ≈ 0.25 km² near equator
                if g.area < 2.5e-5:
                    continue
                geoms.append(g)
            if not geoms:
                continue
            merged = unary_union(geoms)
            parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
            parts = sorted(parts, key=lambda g: g.area, reverse=True)[:150]
            for idx, part in enumerate(parts, start=1):
                simplified = part.simplify(0.004, preserve_topology=True)
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
                        "name": f"{meta['name_prefix']} {idx}",
                        "tier": meta["tier"],
                        "score": meta["score"],
                        "geometry": mapping(mp),
                    }
                )
            log.info(
                "Polygonized history %s → %d zones",
                meta["tier"],
                sum(1 for f in features_out if f["tier"] == meta["tier"]),
            )
    return features_out


def save_history_vectors(features: list[dict], valid_from: date, valid_to: date):
    """Replace inundation_history rows in flood_risk_areas."""
    import json
    import psycopg2

    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM flood_risk_areas WHERE source = %s", (HISTORY_SOURCE,)
            )
            for feat in features:
                cur.execute(
                    """
                    INSERT INTO flood_risk_areas
                      (name, admin_level, state, geom, risk_score, risk_tier,
                       source, valid_from, valid_to, updated_at)
                    VALUES (
                      %s, 'history', NULL,
                      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)),
                      %s, %s, %s, %s, %s, NOW()
                    )
                    """,
                    (
                        feat["name"],
                        json.dumps(feat["geometry"]),
                        feat["score"],
                        feat["tier"],
                        HISTORY_SOURCE,
                        valid_from,
                        valid_to,
                    ),
                )
        conn.commit()
    finally:
        conn.close()
    log.info("Saved %d inundation history polygons", len(features))


def register_tile_in_db(minio_path: str, source: str, label: str, valid_from: date, valid_to: date,
                        titiler_base: str = "http://localhost:8888"):
    """Upsert a raster record into flood_risk_tiles."""
    import psycopg2

    tile_url = f"{titiler_base}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png?url={minio_path}"

    conn = psycopg2.connect(DB_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM flood_risk_tiles WHERE source = %s", (source,))
            cur.execute(
                """
                INSERT INTO flood_risk_tiles (source, label, minio_path, tile_url, valid_from, valid_to)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (source, label, minio_path, tile_url, valid_from, valid_to),
            )
        conn.commit()
    finally:
        conn.close()
    log.info("Registered %s layer in flood_risk_tiles", source)


def run(mode: str = "monthly"):
    """Main entry point."""
    today = date.today()
    if mode == "weekly":
        valid_from = today
        valid_to = today + timedelta(days=7)
        scale_key = "scale_m_weekly"
        default_scale = 500
    else:
        valid_from = today.replace(day=1)
        valid_to = (valid_from + timedelta(days=32)).replace(day=1)
        scale_key = "scale_m_monthly"
        default_scale = 1000

    if not init_gee():
        log.warning("GEE unavailable; falling back to synthetic risk areas only")
        from synthetic_flood_risk import generate_synthetic_risk

        generate_synthetic_risk()
        return

    try:
        layers, nigeria = build_layers()
        for source, image in layers.items():
            info = SOURCE_DEFS[source]
            filename = info["filename"].format(valid_from=valid_from, mode=mode)
            scale_m = int(info.get(scale_key, default_scale))
            minio_path, local_cog = export_to_minio(
                image,
                nigeria,
                filename,
                scale_m,
                tiled=bool(info.get("tiled_export")),
                keep_local=False,
            )
            if minio_path:
                register_tile_in_db(minio_path, source, info["label"], valid_from, valid_to)
            else:
                log.error("Export failed for %s", source)

    except Exception as exc:
        log.error("GEE ingest error: %s", exc, exc_info=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["weekly", "monthly"], default="monthly")
    args = parser.parse_args()
    run(args.mode)
