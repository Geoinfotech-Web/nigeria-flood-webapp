"""Fast flood_features build from real GloFAS (daily) + OpenMeteo (hourly) data.

Creates one feature row per gauge reading timestamp (typically daily),
joining nearby met rainfall via inverse-distance weights already in Python
or a simple nearest-met aggregate in SQL.

Usage:
  python fast_features_real.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from idw_rainfall import build_gauge_met_weights, weighted_rainfall_mm

logging.basicConfig(level=logging.INFO, format="%(asctime)s [fast-feat] %(message)s")
log = logging.getLogger(__name__)

DB_DSN = (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME','flooddb')} "
    f"user={os.getenv('DB_USER','flood')} "
    f"password={os.getenv('DB_PASSWORD','floodpass')}"
)


def main() -> int:
    conn = psycopg2.connect(DB_DSN)
    weight_map = build_gauge_met_weights(conn)
    log.info("IDW weights ready for %d gauges", len(weight_map))

    with conn.cursor() as cur:
        cur.execute("TRUNCATE flood_features")
        cur.execute("""
            SELECT g.id, g.code, g.bank_full_m, r.time, r.water_level_m, r.flow_rate_m3s
            FROM gauge_stations g
            JOIN gauge_readings r ON r.station_id = g.id
            ORDER BY g.id, r.time
        """)
        rows = cur.fetchall()

    log.info("Building features for %d gauge readings", len(rows))

    # Group by station for lag lookups
    by_station: dict[int, list] = {}
    for sid, code, bank, ts, level, flow in rows:
        by_station.setdefault(sid, []).append((code, bank, ts, level, flow))

    batch = []
    total = 0
    for sid, series in by_station.items():
        code = series[0][0]
        bank = float(series[0][1])
        log.info("Station %s (%d points)", code, len(series))
        for i, (_, _, ts, level, flow) in enumerate(series):
            if level is None:
                continue
            # Prior-day and ~3-day level changes (daily GloFAS cadence)
            level_1h = series[i - 1][3] if i >= 1 and series[i - 1][3] is not None else level
            level_3h = series[i - 3][3] if i >= 3 and series[i - 3][3] is not None else level_1h

            # Peak lookback
            peak_ts = None
            for j in range(i, -1, -1):
                if series[j][3] is not None and series[j][3] >= 0.9 * bank:
                    peak_ts = series[j][2]
                    break
            days_since = (ts - peak_ts).total_seconds() / 86400.0 if peak_ts else 30.0

            from datetime import timedelta, timezone
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            rain_3h = weighted_rainfall_mm(conn, sid, ts - timedelta(hours=3), ts, weight_map)
            rain_24h = weighted_rainfall_mm(conn, sid, ts - timedelta(hours=24), ts, weight_map)

            batch.append((
                ts, sid,
                round(float(level), 3), round(float(flow or 0), 2),
                round(float(level) - float(level_1h), 4),
                round(float(level) - float(level_3h), 4),
                round(rain_3h, 2), round(rain_24h, 2),
                round(min(1.0, rain_24h / 80.0), 4),
                round(days_since, 2),
                round(float(level) / bank if bank else 0, 4),
            ))
            if len(batch) >= 200:
                _flush(conn, batch)
                total += len(batch)
                batch = []

        if batch:
            _flush(conn, batch)
            total += len(batch)
            batch = []
        log.info("  %s done (running total %d)", code, total)

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM flood_features")
        log.info("Total flood_features rows: %d", cur.fetchone()[0])
    conn.close()
    log.info("Fast feature build complete.")
    return 0


def _flush(conn, batch):
    from psycopg2.extras import execute_values
    cols = (
        "time,station_id,water_level_m,flow_rate_m3s,"
        "level_change_1h,level_change_3h,"
        "rolling_rain_3h_mm,rolling_rain_24h_mm,"
        "soil_moisture_idx,days_since_last_peak,level_pct_bank"
    )
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"INSERT INTO flood_features ({cols}) VALUES %s ON CONFLICT DO NOTHING",
            batch,
        )
    conn.commit()


if __name__ == "__main__":
    raise SystemExit(main())
