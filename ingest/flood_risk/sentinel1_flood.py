"""
Sentinel-1 SAR Flood Detection — Google Earth Engine
=====================================================
Uses Sentinel-1 C-band SAR (Synthetic Aperture Radar) to detect
actual flooded areas across Nigeria. SAR penetrates clouds, making
it ideal for flood monitoring during the rainy season when optical
imagery is obscured.

Method:
  1. Fetch recent Sentinel-1 GRD imagery (VV polarisation, IW mode)
  2. Compare current backscatter against a 2-year historical baseline
  3. Pixels where current VV < (baseline_mean - 1.5 * baseline_std)
     are classified as flooded (water has very low SAR backscatter)
  4. Apply slope mask (>5° slopes cannot be flooded)
  5. Apply permanent water mask (JRC) to exclude lakes/rivers
  6. Export detected flood extent as:
     a. COG raster → MinIO → TiTiler map tiles
     b. State-level summaries → flood_risk_areas table

Schedule: weekly (new Sentinel-1 pass every 6-12 days over Nigeria)
Run:  DB_HOST=localhost GEE_SERVICE_ACCOUNT_EMAIL=... GEE_SERVICE_ACCOUNT_KEY=... \\
        python ingest/flood_risk/sentinel1_flood.py

Prerequisites:
  pip install earthengine-api rasterio boto3 numpy psycopg2-binary
"""

import os
import sys
import json
import logging
import tempfile
import argparse
from datetime import date, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [sentinel1] %(message)s", force=True)
log = logging.getLogger(__name__)

GEE_KEY_FILE   = os.getenv("GEE_SERVICE_ACCOUNT_KEY", "")
GEE_SA_EMAIL   = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL", "")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_KEY      = os.getenv("MINIO_ROOT_USER", "minioadmin")
MINIO_SECRET   = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
MINIO_BUCKET   = "flood-risk-tiles"

NIGERIA_BBOX = [2.7, 4.0, 14.7, 14.0]

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)

# Nigeria states with centroids for zonal statistics
NIGERIA_STATES = [
    ("Kogi",       6.74,  7.80), ("Anambra",    6.78,  6.22),
    ("Delta",      5.95,  5.50), ("Rivers",     7.02,  4.85),
    ("Bayelsa",    6.07,  4.78), ("Cross River",8.33,  5.87),
    ("Edo",        6.11,  6.34), ("Imo",        7.05,  5.57),
    ("Enugu",      7.51,  6.44), ("Ebonyi",     8.09,  6.26),
    ("Kaduna",     7.72, 10.52), ("Niger",      5.58,  9.93),
    ("Kebbi",      4.20, 12.45), ("Sokoto",     5.24, 13.06),
    ("Zamfara",    6.22, 12.17), ("Katsina",    7.60, 12.98),
    ("Kano",       8.52, 12.05), ("Jigawa",     9.56, 12.22),
    ("Yobe",      11.97, 12.29), ("Borno",     13.16, 11.85),
    ("Adamawa",   12.39,  9.33), ("Taraba",    11.44,  8.00),
    ("Gombe",     11.17, 10.29), ("Bauchi",     9.84, 10.31),
    ("Plateau",    8.89,  9.22), ("Nassarawa",  8.52,  8.50),
    ("Benue",      8.74,  7.34), ("Kwara",      4.55,  8.49),
    ("Oyo",        3.95,  8.16), ("Osun",       4.58,  7.56),
    ("Ondo",       4.84,  7.10), ("Ekiti",      5.22,  7.62),
    ("Lagos",      3.38,  6.52), ("Ogun",       3.35,  7.16),
    ("Abuja FCT",  7.49,  9.08), ("Abia",       7.52,  5.45),
    ("Akwa Ibom",  7.85,  4.90),
]


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


def build_flood_extent(days_back: int = 10) -> tuple:
    """
    Detect flooded pixels using Sentinel-1 SAR change detection.

    Returns (flood_image, nigeria_geometry) where flood_image is a
    binary raster (1=flooded, 0=not flooded), scaled 0-100 for display.
    """
    import ee

    today   = date.today()
    t_start = (today - timedelta(days=days_back)).isoformat()
    t_end   = today.isoformat()

    nigeria = ee.Geometry.BBox(*NIGERIA_BBOX)

    # ── Sentinel-1 current composite ────────────────────────────────────────
    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD")
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
          .filter(ee.Filter.eq("orbitProperties_pass", "DESCENDING"))
          .filterBounds(nigeria)
          .select("VV"))

    current = (s1.filterDate(t_start, t_end)
               .median()
               .clip(nigeria))

    # ── 2-year historical baseline ───────────────────────────────────────────
    baseline_start = (today - timedelta(days=730)).isoformat()
    baseline_end   = (today - timedelta(days=30)).isoformat()

    baseline = s1.filterDate(baseline_start, baseline_end)
    baseline_mean = baseline.mean().clip(nigeria)
    baseline_std  = baseline.reduce(ee.Reducer.stdDev()).clip(nigeria)

    # ── Flood detection: current < mean - 1.5*std ───────────────────────────
    # (flooded areas have significantly lower backscatter)
    threshold = baseline_mean.subtract(baseline_std.multiply(1.5))
    flood_raw = current.lt(threshold)

    # ── Masks ────────────────────────────────────────────────────────────────
    # Remove steep slopes (>5°) — these can't flood
    srtm  = ee.Image("USGS/SRTMGL1_003")
    slope = ee.Terrain.slope(srtm)
    flat  = slope.lt(5)

    # Remove permanent water bodies (JRC occurrence > 80%)
    jrc      = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence")
    not_perm = jrc.lt(80).unmask(1)

    # Final flood mask
    flood = (flood_raw
             .updateMask(flat)
             .updateMask(not_perm)
             .rename("flood_extent"))

    # Scale to 0-100 for TiTiler display (1=flooded → 100, 0=dry → 0)
    flood_display = flood.multiply(100).toUint8()

    log.info("Sentinel-1 flood extent computed (%s → %s)", t_start, t_end)
    return flood_display, nigeria, flood


def compute_state_flood_pct(flood_image, nigeria) -> dict[str, float]:
    """
    Sample flood fraction at state centroid areas (30km radius).
    Returns {state_name: flood_fraction_0_to_1}.
    """
    import ee

    results = {}
    for name, lon, lat in NIGERIA_STATES:
        try:
            pt   = ee.Geometry.Point(lon, lat)
            buf  = pt.buffer(30000)  # 30 km radius
            stat = flood_image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=buf,
                scale=100,
                maxPixels=1e7,
            ).getInfo()
            val = stat.get("flood_extent", 0) or 0
            results[name] = round(float(val) / 100.0, 4)
        except Exception as exc:
            log.warning("State sample failed [%s]: %s", name, exc)
            results[name] = 0.0
    return results


def _to_cog(src: str, dst: str):
    try:
        import rasterio
        from rasterio.shutil import copy as rio_copy
        with rasterio.open(src) as s:
            rio_copy(s, dst, driver="GTiff",
                     tiled=True, blockxsize=512, blockysize=512,
                     compress="deflate")
        log.info("COG created: %s", dst)
    except ImportError:
        import shutil
        shutil.copy(src, dst)


def export_to_minio(image, region, filename: str, scale_m: int = 1000) -> str | None:
    """
    Export GEE raster to MinIO as COG.

    GEE's getDownloadURL has a ~32 MB limit — insufficient for Nigeria-wide
    imagery at useful resolution. We therefore use GEE's async Export API
    which writes to Google Cloud Storage, then copy to MinIO.

    Fallback: if GCS bucket is not configured, tiles the image into
    sub-regions small enough for getDownloadURL and mosaics them locally.
    """
    import ee, urllib.request, boto3
    from botocore.client import Config

    log.info("Exporting Sentinel-1 flood raster at %dm via tiled download…", scale_m)

    image_filled = image.unmask(0)

    # Split Nigeria into a 3×3 grid of sub-regions to stay under size limit
    w, s, e, n = NIGERIA_BBOX
    lon_splits = [w, w + (e - w) / 3, w + 2 * (e - w) / 3, e]
    lat_splits = [s, s + (n - s) / 2, n]

    tiles = []
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, (x0, x1) in enumerate(zip(lon_splits, lon_splits[1:])):
            for j, (y0, y1) in enumerate(zip(lat_splits, lat_splits[1:])):
                tile_region = ee.Geometry.BBox(x0, y0, x1, y1)
                tile_file   = os.path.join(tmpdir, f"tile_{i}_{j}.tif")
                try:
                    url = image_filled.getDownloadURL({
                        "region": tile_region, "scale": scale_m,
                        "crs": "EPSG:4326", "format": "GEO_TIFF",
                    })
                    urllib.request.urlretrieve(url, tile_file)
                    tiles.append(tile_file)
                    log.info("  Tile [%d,%d] downloaded (%.1f MB)",
                             i, j, Path(tile_file).stat().st_size / 1e6)
                except Exception as exc:
                    log.warning("  Tile [%d,%d] failed: %s", i, j, exc)

        if not tiles:
            log.error("All tiles failed — skipping raster export")
            return None

        # Mosaic tiles with gdal_merge or rasterio
        merged_path = os.path.join(tmpdir, "merged.tif")
        cog_path    = os.path.join(tmpdir, "merged_cog.tif")
        try:
            import rasterio
            from rasterio.merge import merge as rio_merge
            datasets = [rasterio.open(t) for t in tiles]
            mosaic, transform = rio_merge(datasets)
            profile = datasets[0].profile.copy()
            profile.update({"width": mosaic.shape[2], "height": mosaic.shape[1],
                            "transform": transform})
            with rasterio.open(merged_path, "w", **profile) as dst:
                dst.write(mosaic)
            for ds in datasets:
                ds.close()
            _to_cog(merged_path, cog_path)
            log.info("Mosaic created: %.1f MB", Path(cog_path).stat().st_size / 1e6)
        except Exception as exc:
            log.warning("Mosaic failed (%s) — using first tile", exc)
            cog_path = tiles[0]

        # Upload to MinIO
        try:
            s3 = boto3.client(
                "s3", endpoint_url=MINIO_ENDPOINT,
                aws_access_key_id=MINIO_KEY,
                aws_secret_access_key=MINIO_SECRET,
                config=Config(signature_version="s3v4"),
            )
            try:
                s3.create_bucket(Bucket=MINIO_BUCKET)
            except Exception:
                pass
            s3.upload_file(cog_path, MINIO_BUCKET, filename,
                           ExtraArgs={"ContentType": "image/tiff"})
            log.info("Uploaded %s to MinIO", filename)
            return f"s3://{MINIO_BUCKET}/{filename}"
        except Exception as exc:
            log.error("MinIO upload failed: %s", exc)
            return None

    # ── original single-tile path kept as dead-code reference ──
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp_path = tmp.name
    cog_path2 = tmp_path.replace(".tif", "_cog.tif")

    try:
        urllib.request.urlretrieve("", tmp_path)
        size_mb = Path(tmp_path).stat().st_size / 1e6
        log.info("Downloaded %.1f MB", size_mb)
        _to_cog(tmp_path, cog_path2)

        s3 = boto3.client(
            "s3", endpoint_url=MINIO_ENDPOINT,
            aws_access_key_id=MINIO_KEY,
            aws_secret_access_key=MINIO_SECRET,
            config=Config(signature_version="s3v4"),
        )
        try:
            s3.create_bucket(Bucket=MINIO_BUCKET)
        except Exception:
            pass
        s3.upload_file(cog_path, MINIO_BUCKET, filename,
                       ExtraArgs={"ContentType": "image/tiff"})
        log.info("Uploaded %s to MinIO", filename)
        return f"s3://{MINIO_BUCKET}/{filename}"
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        Path(cog_path).unlink(missing_ok=True)


def save_to_db(minio_path: str, state_flood_pct: dict[str, float],
               valid_from: date, valid_to: date):
    """
    1. Register COG tile in flood_risk_tiles
    2. Upsert state-level flood extent into flood_risk_areas
    """
    import psycopg2

    conn = psycopg2.connect(DB_DSN)
    titiler_base = os.getenv("TITILER_URL", "http://localhost:8888")
    tile_url = (
        f"{titiler_base}/cog/tiles/{{z}}/{{x}}/{{y}}.png"
        f"?url={minio_path}&colormap_name=blues&rescale=0,100"
    )

    with conn.cursor() as cur:
        # Register tile
        cur.execute("""
            INSERT INTO flood_risk_tiles
              (source, label, minio_path, tile_url, valid_from, valid_to)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, ("sentinel1", f"SAR Flood Extent {valid_from}", minio_path,
               tile_url, valid_from, valid_to))

        # Upsert state risk areas from SAR flood fraction
        cur.execute("DELETE FROM flood_risk_areas WHERE source = 'sentinel1'")
        for name, lon, lat in NIGERIA_STATES:
            flood_frac = state_flood_pct.get(name, 0.0)
            # Map flood fraction to risk score (0–1)
            # 0% flooded → 0.1 baseline, 20%+ flooded → 1.0 emergency
            score = min(1.0, 0.1 + flood_frac * 4.5)
            if score >= 0.75:
                tier = "Emergency"
            elif score >= 0.50:
                tier = "Warning"
            elif score >= 0.25:
                tier = "Watch"
            else:
                tier = "Normal"

            size = 0.8
            w, s, e, n = lon - size, lat - size * 0.75, lon + size, lat + size * 0.75
            wkt = (f"MULTIPOLYGON(((({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))))")

            cur.execute("""
                INSERT INTO flood_risk_areas
                  (name, admin_level, state, geom, risk_score, risk_tier,
                   source, valid_from, valid_to, updated_at)
                VALUES (%s, 'state', %s, ST_GeomFromText(%s, 4326),
                        %s, %s, 'sentinel1', %s, %s, NOW())
            """, (name, name, wkt, round(score, 3), tier, valid_from, valid_to))

    conn.commit()
    conn.close()
    log.info("Saved %d state flood estimates to DB", len(state_flood_pct))
    log.info("Registered tile: %s", tile_url)


def run():
    today      = date.today()
    valid_from = today
    valid_to   = today + timedelta(days=7)
    filename   = f"nigeria_sentinel1_flood_{today}.tif"

    if not init_gee():
        log.error("GEE not available — cannot run Sentinel-1 detection")
        sys.exit(1)

    log.info("Building Sentinel-1 flood extent (last 10 days)…")
    flood_display, nigeria, flood_raw = build_flood_extent(days_back=10)

    log.info("Computing state-level flood fractions…")
    state_pct = compute_state_flood_pct(flood_raw, nigeria)

    flooded_states = [(n, p) for n, p in state_pct.items() if p > 0.01]
    flooded_states.sort(key=lambda x: -x[1])
    log.info("Flooded states detected: %d", len(flooded_states))
    for name, pct in flooded_states[:10]:
        log.info("  %-20s  %.1f%% flooded", name, pct * 100)

    log.info("Exporting raster to MinIO…")
    minio_path = export_to_minio(flood_display, nigeria, filename, scale_m=250)

    if minio_path:
        save_to_db(minio_path, state_pct, valid_from, valid_to)
        log.info("Sentinel-1 flood detection complete")
    else:
        log.error("Raster export failed — saving state summaries only")
        save_to_db(f"s3://{MINIO_BUCKET}/{filename}", state_pct, valid_from, valid_to)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Sentinel-1 SAR flood detection for Nigeria")
    parser.add_argument("--days-back", type=int, default=10,
                        help="Days of recent SAR imagery to composite (default: 10)")
    args = parser.parse_args()
    run()
