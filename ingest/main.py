"""
Ingest container entrypoint.
Runs both gauge and met simulators concurrently using threads.
"""
import threading
import logging

from simulate_gauges import run as run_gauges
from simulate_met import run as run_met

logging.basicConfig(level=logging.INFO, format="%(asctime)s [ingest] %(message)s")
log = logging.getLogger(__name__)

if __name__ == "__main__":
    log.info("Starting ingest service…")
    t_gauge = threading.Thread(target=run_gauges, name="gauges", daemon=True)
    t_met   = threading.Thread(target=run_met,    name="met",    daemon=True)
    t_gauge.start()
    t_met.start()
    t_gauge.join()
    t_met.join()
