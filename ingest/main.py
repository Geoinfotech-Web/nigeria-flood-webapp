"""
Ingest container entrypoint — APScheduler
==========================================
Runs all data ingest jobs on a fixed schedule:

  Every hour       real_data.py           — OpenMeteo + GloFAS gauge/met readings
  Every 3 hours    urban_flash_flood.py   — short-range urban flash-flood alerts
  Monthly (1st)    gee_flood_risk.py      — JRC+SRTM flood susceptibility COG
  Monthly (1st)    inundation_extent.py   — SAR+DEM Very High / High / Moderate extents
  Monthly (1st)    urban_footprints.py    — GEE ESA WorldCover urban clusters

GEE jobs are skipped gracefully if credentials are not configured.
"""

import logging
import os
import sys
import threading
from datetime import date

import psycopg2
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ingest] %(message)s",
    force=True,
)
log = logging.getLogger(__name__)

# Add /app to path so sub-modules resolve correctly inside the container
sys.path.insert(0, "/app")
sys.path.insert(0, "/app/flood_risk")

DB_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'flooddb')} "
    f"user={os.getenv('DB_USER', 'flood')} "
    f"password={os.getenv('DB_PASSWORD', 'floodpass')}"
)


# ── Job functions ─────────────────────────────────────────────────────────────

def job_real_data():
    """Fetch live gauge + met readings from OpenMeteo / GloFAS."""
    log.info("── job_real_data starting")
    try:
        from flood_risk.real_data import run_once
        run_once()
    except Exception as exc:
        log.error("job_real_data failed: %s", exc)


def job_urban_flash():
    """Classify urban footprints with OpenMeteo rainfall → Likely / Highly Likely."""
    log.info("── job_urban_flash starting")
    try:
        from flood_risk.urban_flash_flood import run as run_flash
        run_flash()
    except Exception as exc:
        log.error("job_urban_flash failed: %s", exc)


def job_gee_composite():
    """Download monthly JRC+SRTM flood susceptibility COG from GEE → MinIO."""
    email = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL")
    key   = os.getenv("GEE_SERVICE_ACCOUNT_KEY")
    if not email or not key:
        log.warning("job_gee_composite skipped — GEE credentials not configured")
        return
    log.info("── job_gee_composite starting")
    try:
        from flood_risk.gee_flood_risk import run as run_gee
        run_gee(mode="monthly")
    except SystemExit as exc:
        log.error("job_gee_composite stopped early (exit %s)", exc.code)
    except Exception as exc:
        log.error("job_gee_composite failed: %s", exc)


def job_sentinel1():
    """Run SAR+DEM Very High / High / Moderate inundation → MinIO + polygons."""
    email = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL")
    key   = os.getenv("GEE_SERVICE_ACCOUNT_KEY")
    if not email or not key:
        log.warning("job_sentinel1 skipped — GEE credentials not configured")
        return
    log.info("── job_sentinel1 (SAR/DEM inundation) starting")
    try:
        from flood_risk.inundation_extent import run as run_inundation
        run_inundation()
    except SystemExit as exc:
        log.error("job_sentinel1 stopped early (exit %s)", exc.code)
    except Exception as exc:
        log.error("job_sentinel1 failed: %s", exc)


def job_urban_footprints():
    """GEE ESA WorldCover built-up clusters → urban_footprints table."""
    email = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL")
    key   = os.getenv("GEE_SERVICE_ACCOUNT_KEY")
    if not email or not key:
        log.warning("job_urban_footprints skipped — GEE credentials not configured")
        return
    log.info("── job_urban_footprints starting")
    try:
        from flood_risk.urban_footprints import run as run_footprints
        run_footprints()
    except SystemExit as exc:
        log.error("job_urban_footprints stopped early (exit %s)", exc.code)
    except Exception as exc:
        log.error("job_urban_footprints failed: %s", exc)


def job_historical_events():
    """Build Global Flood Database event polygons and recurrence hotspots."""
    email = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL")
    key = os.getenv("GEE_SERVICE_ACCOUNT_KEY")
    if not email or not key:
        log.warning("job_historical_events skipped — GEE credentials not configured")
        return
    log.info("── job_historical_events starting")
    try:
        from flood_risk.historical_events import run as run_historical_events
        run_historical_events()
    except SystemExit as exc:
        log.error("job_historical_events stopped early (exit %s)", exc.code)
    except Exception as exc:
        log.error("job_historical_events failed: %s", exc)


def _geospatial_refresh_state() -> dict[str, bool]:
    """Return which persisted map products are absent or out of date."""
    today = date.today()
    state = {
        "gee_composite": True,
        "inundation": True,
        "urban_footprints": True,
        "historical_events": True,
    }
    with psycopg2.connect(DB_DSN) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT source, MAX(valid_to)
            FROM flood_risk_tiles
            WHERE source = ANY(%s)
            GROUP BY source
            """,
            (["jrc_occurrence", "gee_susceptibility_classes"],),
        )
        tile_valid_to = {source: valid_to for source, valid_to in cur.fetchall()}
        state["gee_composite"] = any(
            not tile_valid_to.get(source) or tile_valid_to[source] < today
            for source in ("jrc_occurrence", "gee_susceptibility_classes")
        )

        cur.execute(
            "SELECT MAX(valid_to) FROM flood_risk_areas WHERE source = 'sar_dem_inundation'"
        )
        inundation_valid_to = cur.fetchone()[0]
        state["inundation"] = not inundation_valid_to or inundation_valid_to < today

        cur.execute("SELECT COUNT(*) FROM urban_footprints")
        state["urban_footprints"] = cur.fetchone()[0] == 0

        cur.execute("SELECT to_regclass('public.historical_flood_hotspots')")
        if cur.fetchone()[0]:
            cur.execute("SELECT COUNT(*) FROM historical_flood_hotspots")
            state["historical_events"] = cur.fetchone()[0] == 0
    return state


def bootstrap_geospatial_layers():
    """Refresh missing/stale map products after a service restart.

    Runs in a daemon thread so live observations and the scheduler remain
    available while the slower Earth Engine exports complete.
    """
    try:
        state = _geospatial_refresh_state()
    except Exception as exc:
        log.error("Could not inspect geospatial freshness: %s", exc)
        job_urban_flash()
        return

    due = [name for name, needed in state.items() if needed]
    log.info("Geospatial bootstrap due: %s", ", ".join(due) if due else "none")

    # Urban flash depends on footprints, so repair that dependency first and
    # classify immediately rather than waiting behind the larger raster jobs.
    if state["urban_footprints"]:
        job_urban_footprints()
    job_urban_flash()

    if state["gee_composite"]:
        job_gee_composite()
    if state["inundation"]:
        job_sentinel1()
    if state["historical_events"]:
        job_historical_events()

    log.info("Geospatial bootstrap completed")


# ── APScheduler listener ──────────────────────────────────────────────────────

def on_job_event(event):
    if event.exception:
        log.error("Scheduled job %s raised an exception", event.job_id)
    else:
        log.info("Scheduled job %s completed", event.job_id)


# ── Background simulators (dev / synthetic fallback) ─────────────────────────

def _start_simulators():
    """Run synthetic gauge + met simulators in daemon threads.
    Safe to keep running alongside real data — DB uses ON CONFLICT DO NOTHING.
    """
    try:
        from simulate_gauges import run as run_gauges
        from simulate_met import run as run_met
        tg = threading.Thread(target=run_gauges, name="sim-gauges", daemon=True)
        tm = threading.Thread(target=run_met,    name="sim-met",    daemon=True)
        tg.start()
        tm.start()
        log.info("Synthetic simulators started (daemon threads)")
    except ImportError:
        log.warning("Simulator modules not found — skipping synthetic data")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("Starting ingest service with APScheduler")

    simulators_enabled = os.getenv("ENABLE_SYNTHETIC_SIMULATORS", "0").lower() in {
        "1", "true", "yes", "on",
    }
    if simulators_enabled:
        _start_simulators()
    else:
        log.info("Synthetic simulators disabled; using live observation feeds")

    # Run live observations immediately. Geospatial products refresh in the
    # background when missing or stale, with footprints before urban flash.
    job_real_data()
    bootstrap_enabled = os.getenv("BOOTSTRAP_GEOSPATIAL_ON_STARTUP", "1").lower() not in {
        "0", "false", "no", "off",
    }
    if bootstrap_enabled:
        threading.Thread(
            target=bootstrap_geospatial_layers,
            name="geospatial-bootstrap",
            daemon=True,
        ).start()
    else:
        job_urban_flash()

    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_listener(on_job_event, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR)

    # ── Hourly jobs ───────────────────────────────────────────────────────────
    # Offset by a few minutes so they don't all fire simultaneously
    scheduler.add_job(
        job_real_data,
        trigger="cron",
        minute=5,           # xx:05 every hour
        id="real_data",
        name="OpenMeteo + GloFAS ingest",
        max_instances=1,
        misfire_grace_time=300,
    )
    # ── Every 3 hours — urban flash flood ─────────────────────────────────────
    scheduler.add_job(
        job_urban_flash,
        trigger="cron",
        hour="*/3",
        minute=35,          # xx:35 every 3 hours
        id="urban_flash",
        name="Urban flash flood (OpenMeteo rainfall)",
        max_instances=1,
        misfire_grace_time=600,
    )

    # ── Monthly jobs — 1st of every month ────────────────────────────────────
    scheduler.add_job(
        job_gee_composite,
        trigger="cron",
        day=1, hour=2, minute=0,    # 02:00 UTC on the 1st
        id="gee_composite",
        name="GEE JRC+SRTM composite COG",
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        job_sentinel1,
        trigger="cron",
        day=1, hour=3, minute=30,   # 03:30 UTC on the 1st (after GEE composite)
        id="sentinel1_sar",
        name="SAR/DEM Very High–High–Moderate inundation",
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        job_urban_footprints,
        trigger="cron",
        day=1, hour=4, minute=0,    # 04:00 UTC on the 1st (after inundation)
        id="urban_footprints",
        name="GEE urban built-up footprints",
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        job_historical_events,
        trigger="cron",
        month=1, day=2, hour=2, minute=0,
        id="historical_events",
        name="Global Flood Database recurrence hotspots",
        max_instances=1,
        misfire_grace_time=3600,
    )

    log.info(
        "Scheduler started — jobs: real_data (hourly :05), "
        "urban_flash (every 3h :35), "
        "gee_composite (monthly 1st 02:00 UTC), "
        "sentinel1_sar / inundation (monthly 1st 03:30 UTC), "
        "urban_footprints (monthly 1st 04:00 UTC), "
        "historical_events (annual Jan 2 02:00 UTC)"
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Ingest service stopped")
