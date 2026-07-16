"""
Google Earth Engine flood-risk ingest.

Exports two Nigeria-wide rasters clipped to the actual country geometry:
  1. JRC Global Surface Water occurrence (0-100)
  2. Classified flood susceptibility (1-4: Low -> Highly Susceptible)

Both are converted to COGs, uploaded to MinIO, and registered in
`flood_risk_tiles` for serving through the API tile proxy.
"""

import argparse
import logging
import os
import tempfile
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

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)

SOURCE_DEFS = {
    "jrc_occurrence": {
        "filename": "nigeria_inundation_history_classes_{valid_from}_{mode}.tif",
        "label": "Inundation History",
    },
    "gee_susceptibility_classes": {
        "filename": "nigeria_flood_susceptibility_classes_{valid_from}_{mode}.tif",
        "label": "Flood Susceptibility",
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

    countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017")
    nigeria = countries.filter(ee.Filter.eq("country_na", "Nigeria")).geometry()
    return nigeria


def build_layers():
    """Build 3-class inundation history + 4-class susceptibility, clipped to Nigeria."""
    import ee

    nigeria = get_nigeria_geometry()

    jrc_raw = (
        ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
        .select("occurrence")
        .unmask(0)
        .clip(nigeria)
    )

    # Flood Hub–style inundation history: 3 wet-frequency classes (%, time under water).
    # Dry / never-wet pixels are masked so only Nigeria wet history is shown.
    inundation_history = (
        ee.Image(0)
        .where(jrc_raw.gte(5).And(jrc_raw.lt(25)), 1)   # occasional
        .where(jrc_raw.gte(25).And(jrc_raw.lt(50)), 2)  # frequent
        .where(jrc_raw.gte(50), 3)                      # very frequent
        .updateMask(jrc_raw.gte(5))
        .clip(nigeria)
        .rename("inundation_history")
        .toUint8()
    )

    srtm = ee.Image("USGS/SRTMGL1_003").select("elevation").clip(nigeria)
    elev_norm = srtm.unitScale(0, 500).subtract(1).abs()
    slope = ee.Terrain.slope(srtm)
    slope_norm = slope.unitScale(0, 30).subtract(1).abs()

    susceptibility = (
        jrc_raw.multiply(0.5)
        .add(elev_norm.multiply(100).multiply(0.3))
        .add(slope_norm.multiply(100).multiply(0.2))
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
        "jrc_occurrence": inundation_history,  # served as Inundation History (3 wet classes)
        "gee_susceptibility_classes": susceptibility_classes,
    }, nigeria


def export_to_minio(image, region, filename: str, scale_m: int) -> str | None:
    """Download GEE image as GeoTIFF and upload to MinIO as a COG."""
    import boto3
    from botocore.client import Config
    import urllib.request

    log.info("Downloading %s at %dm resolution", filename, scale_m)

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

        s3.upload_file(cog_path, MINIO_BUCKET, filename, ExtraArgs={"ContentType": "image/tiff"})
        log.info("Uploaded %s to bucket %s", filename, MINIO_BUCKET)
        return f"s3://{MINIO_BUCKET}/{filename}"
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        Path(cog_path).unlink(missing_ok=True)


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
        import shutil

        shutil.copy(src_path, dst_path)
        log.warning("rasterio not installed; uploaded original GeoTIFF")


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
        scale_m = 500
    else:
        valid_from = today.replace(day=1)
        valid_to = (valid_from + timedelta(days=32)).replace(day=1)
        scale_m = 1000

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
            minio_path = export_to_minio(image, nigeria, filename, scale_m)
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
