-- ============================================================
-- Nigeria Flood Dashboard — TimescaleDB Init
-- Extensions, tables, hypertables, indexes
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Reference: gauge stations ───────────────────────────────
CREATE TABLE IF NOT EXISTS gauge_stations (
    id          SERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,       -- e.g. 'BENUE_001'
    name        TEXT NOT NULL,
    river       TEXT NOT NULL,
    state       TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    bank_full_m DOUBLE PRECISION NOT NULL,  -- bank-full water level (m)
    geom        GEOMETRY(Point, 4326)
);

-- ─── Reference: meteorological stations ──────────────────────
CREATE TABLE IF NOT EXISTS met_stations (
    id   SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    lat  DOUBLE PRECISION NOT NULL,
    lon  DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326)
);

-- ─── Time-series: gauge readings (hypertable) ────────────────
CREATE TABLE IF NOT EXISTS gauge_readings (
    time            TIMESTAMPTZ NOT NULL,
    station_id      INTEGER     NOT NULL REFERENCES gauge_stations(id),
    water_level_m   DOUBLE PRECISION,      -- metres above datum
    flow_rate_m3s   DOUBLE PRECISION,      -- m³/s
    raw_quality     SMALLINT DEFAULT 1     -- 1=good, 0=suspect
);
SELECT create_hypertable('gauge_readings', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_gauge_readings_station
    ON gauge_readings (station_id, time DESC);

-- ─── Time-series: meteorological readings (hypertable) ───────
CREATE TABLE IF NOT EXISTS met_readings (
    time              TIMESTAMPTZ NOT NULL,
    station_id        INTEGER     NOT NULL REFERENCES met_stations(id),
    rainfall_mm       DOUBLE PRECISION,
    temperature_c     DOUBLE PRECISION,
    humidity_pct      DOUBLE PRECISION,
    wind_speed_ms     DOUBLE PRECISION,
    pressure_hpa      DOUBLE PRECISION
);
SELECT create_hypertable('met_readings', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_met_readings_station
    ON met_readings (station_id, time DESC);

-- ─── Computed: Flink feature snapshots (hypertable) ──────────
CREATE TABLE IF NOT EXISTS flood_features (
    time                 TIMESTAMPTZ NOT NULL,
    station_id           INTEGER     NOT NULL REFERENCES gauge_stations(id),
    water_level_m        DOUBLE PRECISION,
    flow_rate_m3s        DOUBLE PRECISION,
    level_change_1h      DOUBLE PRECISION,  -- delta over last 1h
    level_change_3h      DOUBLE PRECISION,  -- delta over last 3h
    rolling_rain_3h_mm   DOUBLE PRECISION,  -- catchment rainfall 3h
    rolling_rain_24h_mm  DOUBLE PRECISION,  -- catchment rainfall 24h
    soil_moisture_idx    DOUBLE PRECISION,  -- 0–1 proxy from rain history
    days_since_last_peak DOUBLE PRECISION,
    level_pct_bank       DOUBLE PRECISION   -- water_level / bank_full
);
SELECT create_hypertable('flood_features', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_flood_features_station
    ON flood_features (station_id, time DESC);

-- ─── ML predictions (hypertable) ─────────────────────────────
CREATE TABLE IF NOT EXISTS flood_predictions (
    time              TIMESTAMPTZ NOT NULL,  -- prediction issue time
    station_id        INTEGER     NOT NULL REFERENCES gauge_stations(id),
    forecast_horizon  SMALLINT    NOT NULL,  -- hours ahead (6,12,24,48,72)
    flood_prob        DOUBLE PRECISION,      -- 0.0 – 1.0
    risk_tier         TEXT,                  -- Watch/Warning/Emergency
    model_version     TEXT,
    xgb_prob          DOUBLE PRECISION,
    lstm_prob         DOUBLE PRECISION
);
SELECT create_hypertable('flood_predictions', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_flood_predictions_station
    ON flood_predictions (station_id, time DESC);

-- ─── Alert log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_log (
    id           SERIAL PRIMARY KEY,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    station_id   INTEGER REFERENCES gauge_stations(id),
    risk_tier    TEXT NOT NULL,
    flood_prob   DOUBLE PRECISION,
    channel      TEXT,          -- sms / email / dashboard
    recipient    TEXT,
    sent_at      TIMESTAMPTZ,
    status       TEXT DEFAULT 'pending'
);

-- ─── Seed: 5 gauge stations across Nigeria ───────────────────
INSERT INTO gauge_stations (code, name, river, state, lat, lon, bank_full_m, geom)
VALUES
  ('BENUE_LOK', 'Lokoja Confluence',    'Benue/Niger',  'Kogi',    7.7953,  6.7395,  12.5, ST_SetSRID(ST_MakePoint(6.7395, 7.7953),  4326)),
  ('NIGER_OHO', 'Ohoror',               'Niger',        'Delta',   5.5833,  6.0333,  10.8, ST_SetSRID(ST_MakePoint(6.0333, 5.5833),  4326)),
  ('ANAMBRA_OS','Onitsha Gauge',        'Niger',        'Anambra', 6.1539,  6.7850,   9.2, ST_SetSRID(ST_MakePoint(6.7850, 6.1539),  4326)),
  ('KADUNA_ZAR','Zaria Gauge',          'Kaduna',       'Kaduna', 11.0667,  7.7167,   5.6, ST_SetSRID(ST_MakePoint(7.7167,11.0667),  4326)),
  ('SOKOTO_BIR','Birnin Kebbi',         'Sokoto',       'Kebbi',  12.4539,  4.1975,   7.1, ST_SetSRID(ST_MakePoint(4.1975,12.4539),  4326))
ON CONFLICT (code) DO NOTHING;

-- ─── Seed: 4 meteorological stations ─────────────────────────
INSERT INTO met_stations (code, name, lat, lon, geom)
VALUES
  ('MET_ABUJA',  'Abuja NIMET',       9.0765,  7.3986, ST_SetSRID(ST_MakePoint(7.3986,  9.0765), 4326)),
  ('MET_IBADAN', 'Ibadan NIMET',      7.3776,  3.9470, ST_SetSRID(ST_MakePoint(3.9470,  7.3776), 4326)),
  ('MET_KANO',   'Kano Airport',     12.0458,  8.5247, ST_SetSRID(ST_MakePoint(8.5247, 12.0458), 4326)),
  ('MET_PHC',    'Port Harcourt Int', 4.8156,  7.0134, ST_SetSRID(ST_MakePoint(7.0134,  4.8156), 4326))
ON CONFLICT (code) DO NOTHING;

-- ─── Continuous aggregates for dashboard queries ──────────────
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
WITH NO DATA;
