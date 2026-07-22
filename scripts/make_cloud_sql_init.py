from pathlib import Path

src = Path("infra/timescaledb/init.sql").read_text(encoding="utf-8")
out = src.replace(
    "CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;\n",
    "-- TimescaleDB is not available on Cloud SQL; using plain PostgreSQL + PostGIS\n",
).replace(
    "CREATE EXTENSION IF NOT EXISTS postgis;\n",
    "-- PostGIS is created by the apply script as the postgres/cloudsqlsuperuser\n",
)
replacements = {
    "SELECT create_hypertable('gauge_readings', 'time', if_not_exists => TRUE);":
        "CREATE INDEX IF NOT EXISTS idx_gauge_readings_time ON gauge_readings (time DESC);",
    "SELECT create_hypertable('met_readings', 'time', if_not_exists => TRUE);":
        "CREATE INDEX IF NOT EXISTS idx_met_readings_time ON met_readings (time DESC);",
    "SELECT create_hypertable('flood_features', 'time', if_not_exists => TRUE);":
        "CREATE INDEX IF NOT EXISTS idx_flood_features_time ON flood_features (time DESC);",
    "SELECT create_hypertable('flood_predictions', 'time', if_not_exists => TRUE);":
        "CREATE INDEX IF NOT EXISTS idx_flood_predictions_time ON flood_predictions (time DESC);",
}
for old, new in replacements.items():
    if old not in out:
        raise SystemExit(f"missing: {old}")
    out = out.replace(old, new)

old_views = """-- ─── Continuous aggregates for dashboard queries ──────────────
-- Hourly gauge summary
CREATE MATERIALIZED VIEW IF NOT EXISTS gauge_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    station_id,
    AVG(water_level_m)  AS avg_level_m,
    MAX(water_level_m)  AS max_level_m,
    AVG(flow_rate_m3s)  AS avg_flow_m3s
FROM gauge_readings
GROUP BY bucket, station_id
WITH NO DATA;

-- Daily rainfall summary
CREATE MATERIALIZED VIEW IF NOT EXISTS rainfall_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    station_id,
    SUM(rainfall_mm)  AS total_rain_mm,
    MAX(rainfall_mm)  AS max_rain_mm
FROM met_readings
GROUP BY bucket, station_id
WITH NO DATA;"""

new_views = """-- ─── Materialized views for dashboard queries (Cloud SQL) ─────
-- Hourly gauge summary
CREATE MATERIALIZED VIEW IF NOT EXISTS gauge_hourly AS
SELECT
    date_trunc('hour', time) AS bucket,
    station_id,
    AVG(water_level_m)  AS avg_level_m,
    MAX(water_level_m)  AS max_level_m,
    AVG(flow_rate_m3s)  AS avg_flow_m3s
FROM gauge_readings
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gauge_hourly_bucket_station
    ON gauge_hourly (bucket, station_id);

-- Daily rainfall summary
CREATE MATERIALIZED VIEW IF NOT EXISTS rainfall_daily AS
SELECT
    date_trunc('day', time) AS bucket,
    station_id,
    SUM(rainfall_mm)  AS total_rain_mm,
    MAX(rainfall_mm)  AS max_rain_mm
FROM met_readings
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rainfall_daily_bucket_station
    ON rainfall_daily (bucket, station_id);"""

if old_views not in out:
    raise SystemExit("continuous aggregate block not found")
out = out.replace(old_views, new_views)

path = Path("infra/timescaledb/init_cloud_sql.sql")
path.write_text(out, encoding="utf-8")
print(f"wrote {path} ({len(out)} chars)")
