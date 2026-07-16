"""
Ingest container entrypoint — APScheduler
==========================================
Runs all data ingest jobs on a fixed schedule:

  Every hour       real_data.py           — OpenMeteo + GloFAS gauge/met readings
  Every hour       synthetic_flood_risk.py — state-level risk scores (seasonal)
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


# ── Job functions ─────────────────────────────────────────────────────────────

def job_real_data():
    """Fetch live gauge + met readings from OpenMeteo / GloFAS."""
    log.info("── job_real_data starting")
    try:
        from flood_risk.real_data import run_once
        run_once()
    except Exception as exc:
        log.error("job_real_data failed: %s", exc)


def job_synthetic_risk():
    """Recompute state-level flood risk scores (seasonal model)."""
    log.info("── job_synthetic_risk starting")
    try:
        from flood_risk.synthetic_flood_risk import run as run_risk
        run_risk()
    except Exception as exc:
        log.error("job_synthetic_risk failed: %s", exc)


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
    except Exception as exc:
        log.error("job_urban_footprints failed: %s", exc)


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

    # Run simulators in background threads
    _start_simulators()

    # Run real data, risk scores, and urban flash immediately on startup
    job_real_data()
    job_synthetic_risk()
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
    scheduler.add_job(
        job_synthetic_risk,
        trigger="cron",
        minute=20,          # xx:20 every hour (after real data has landed)
        id="synthetic_risk",
        name="State-level flood risk scores",
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

    log.info(
        "Scheduler started — jobs: real_data (hourly :05), "
        "synthetic_risk (hourly :20, skipped when inundation present), "
        "urban_flash (every 3h :35), "
        "gee_composite (monthly 1st 02:00 UTC), "
        "sentinel1_sar / inundation (monthly 1st 03:30 UTC), "
        "urban_footprints (monthly 1st 04:00 UTC)"
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Ingest service stopped")
