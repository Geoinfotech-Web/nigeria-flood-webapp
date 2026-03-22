"""
Ingest container entrypoint — APScheduler
==========================================
Runs all data ingest jobs on a fixed schedule:

  Every hour       real_data.py        — OpenMeteo + GloFAS gauge/met readings
  Every hour       synthetic_flood_risk.py — state-level risk scores (seasonal)
  Monthly (1st)    gee_flood_risk.py   — JRC+SRTM flood susceptibility COG
  Monthly (1st)    sentinel1_flood.py  — Sentinel-1 SAR flood extent COG

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
    """Run Sentinel-1 SAR change-detection flood extent → MinIO."""
    email = os.getenv("GEE_SERVICE_ACCOUNT_EMAIL")
    key   = os.getenv("GEE_SERVICE_ACCOUNT_KEY")
    if not email or not key:
        log.warning("job_sentinel1 skipped — GEE credentials not configured")
        return
    log.info("── job_sentinel1 starting")
    try:
        from flood_risk.sentinel1_flood import run as run_sar
        run_sar()
    except Exception as exc:
        log.error("job_sentinel1 failed: %s", exc)


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

    # Run real data and risk scores immediately on startup
    job_real_data()
    job_synthetic_risk()

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
        name="Sentinel-1 SAR flood detection",
        max_instances=1,
        misfire_grace_time=3600,
    )

    log.info(
        "Scheduler started — jobs: real_data (hourly :05), "
        "synthetic_risk (hourly :20), "
        "gee_composite (monthly 1st 02:00 UTC), "
        "sentinel1_sar (monthly 1st 03:30 UTC)"
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("Ingest service stopped")
