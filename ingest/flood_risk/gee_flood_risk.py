"""
Google Earth Engine — Flood Risk Ingest
========================================
Downloads flood risk rasters for Nigeria using GEE datasets:
  - JRC Global Surface Water (historical water occurrence)
  - SRTM elevation (flood-prone low-lying areas)
  - Combined flood susceptibility index

Outputs a Cloud Optimized GeoTIFF to MinIO, which TiTiler serves as XYZ tiles.

Schedule: weekly (cron) or monthly
Run:  python gee_flood_risk.py [--mode weekly|monthly]

Prerequisites:
  1. GEE service account JSON:  set GEE_SERVICE_ACCOUNT_KEY=/path/to/key.json
     OR use personal auth:       run `earthengine authenticate` once
  2. pip install earthengine-api rasterio boto3 numpy

Fallback: if GEE credentials not found, falls back to synthetic_flood_risk.py
"""

import os
import sys
import json
import logging
import argparse
import tempfile
from datetime import date, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [gee] %(message)s", force=True)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
GEE_KEY_FILE   = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL   = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_KEY      = os.getenv("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET   = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET   = "flood-risk-tiles"

# Nigeria bounding box [west, south, east, north]
NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)


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


def build_flood_susceptibility(scale_m: int = 1000) -> "ee.Image":
    """
    Composite flood susceptibility index 0–100 for Nigeria.
    Combines:
      - JRC water occurrence (historical flooding)
      - Elevation inversion (low areas more at risk)
      - Slope inversion  (flat areas accumulate water)
    """
    import ee

    nigeria = ee.Geometry.BBox(*NIGERIA_BBOX)

    # 1) JRC Global Surface Water occurrence (0-100 = % of time water present)
    jrc = (ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
           .select("occurrence")
           .unmask(0)
           .clip(nigeria))

    # 2) SRTM elevation → invert and normalise (lower = higher risk)
    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(nigeria)
    elev_norm = srtm.unitScale(0, 500).subtract(1).abs()  # 0=high, 1=low elevation

    # 3) Slope from SRTM (flat = more flooding)
    slope = ee.Terrain.slope(srtm)
    slope_norm = slope.unitScale(0, 30).subtract(1).abs()  # 0=steep, 1=flat

    # Weighted composite
    susceptibility = (
        jrc.multiply(0.5)
        .add(elev_norm.multiply(100).multiply(0.3))
        .add(slope_norm.multiply(100).multiply(0.2))
    ).rename("flood_susceptibility").clamp(0, 100)

    return susceptibility, nigeria


def export_to_minio(image: "ee.Image", region: "ee.Geometry",
                    filename: str, scale_m: int) -> str | None:
    """
    Download GEE image as GeoTIFF and upload to MinIO as COG.
    Returns the MinIO object path or None on failure.
    """
    import ee
    import boto3
    from botocore.client import Config

    log.info("Downloading GEE image at %dm resolution…", scale_m)

    # Get download URL (small area: limit to ~50 MB)
    try:
        url = image.getDownloadURL({
            "region": region,
            "scale": scale_m,
            "crs": "EPSG:4326",
            "format": "GEO_TIFF",
        })
    except Exception as exc:
        log.error("GEE getDownloadURL failed: %s", exc)
        return None

    import urllib.request
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        log.info("Fetching raster from GEE download URL…")
        urllib.request.urlretrieve(url, tmp_path)
        log.info("Downloaded %.1f MB", Path(tmp_path).stat().st_size / 1e6)

        # Convert to Cloud Optimized GeoTIFF
        cog_path = tmp_path.replace(".tif", "_cog.tif")
        _to_cog(tmp_path, cog_path)

        # Upload to MinIO
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
            pass  # bucket already exists

        s3.upload_file(cog_path, MINIO_BUCKET, filename,
                       ExtraArgs={"ContentType": "image/tiff"})
        log.info("Uploaded %s to MinIO bucket %s", filename, MINIO_BUCKET)
        return f"s3://{MINIO_BUCKET}/{filename}"

    finally:
        Path(tmp_path).unlink(missing_ok=True)
        Path(cog_path).unlink(missing_ok=True)


def _to_cog(src_path: str, dst_path: str):
    """Convert GeoTIFF to Cloud Optimized GeoTIFF using rasterio."""
    try:
        import rasterio
        from rasterio.shutil import copy as rio_copy
        with rasterio.open(src_path) as src:
            rio_copy(src, dst_path, driver="GTiff", copy_src_overwrite=True,
                     tiled=True, blockxsize=512, blockysize=512,
                     compress="deflate", overviews="AUTO")
        log.info("COG created: %s", dst_path)
    except ImportError:
        import shutil
        shutil.copy(src_path, dst_path)
        log.warning("rasterio not installed — skipping COG conversion")


def register_tile_in_db(minio_path: str, source: str,
                        valid_from: date, valid_to: date,
                        titiler_base: str = "http://localhost:8888"):
    """Record the tile in flood_risk_tiles table."""
    import psycopg2
    conn = psycopg2.connect(DB_DSN)
    # TiTiler tile URL pattern for COG served from MinIO via /cog/tiles endpoint
    tile_url = (
        f"{titiler_base}/cog/tiles/{{z}}/{{x}}/{{y}}.png"
        f"?url={minio_path}"
    )
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO flood_risk_tiles (source, label, minio_path, tile_url,
                                          valid_from, valid_to)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, (source, f"Flood susceptibility {valid_from}", minio_path,
               tile_url, valid_from, valid_to))
    conn.commit()
    conn.close()
    log.info("Registered tile: %s", tile_url)


def run(mode: str = "monthly"):
    """Main entry point."""
    today = date.today()
    if mode == "weekly":
        valid_from = today
        valid_to   = today + timedelta(days=7)
        scale_m    = 500   # 500m res for weekly (smaller area possible)
    else:
        valid_from = today.replace(day=1)
        valid_to   = (valid_from + timedelta(days=32)).replace(day=1)
        scale_m    = 1000  # 1km res for monthly country-wide

    filename = f"nigeria_flood_susceptibility_{valid_from}_{mode}.tif"

    if not init_gee():
        log.warning("GEE unavailable — running synthetic fallback")
        from synthetic_flood_risk import generate_synthetic_risk
        generate_synthetic_risk()
        return

    try:
        import ee
        susceptibility, nigeria = build_flood_susceptibility(scale_m)
        minio_path = export_to_minio(susceptibility, nigeria, filename, scale_m)
        if minio_path:
            register_tile_in_db(minio_path, "gee_jrc", valid_from, valid_to)
            log.info("GEE flood risk ingest complete: %s", minio_path)
        else:
            log.error("Export failed — no tile registered")
    except Exception as exc:
        log.error("GEE ingest error: %s", exc, exc_info=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["weekly", "monthly"], default="monthly")
    args = parser.parse_args()
    run(args.mode)
