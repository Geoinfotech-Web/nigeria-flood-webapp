-- ============================================================
-- Nigeria Flood Dashboard — TimescaleDB Init
-- Extensions, tables, hypertables, indexes
-- ============================================================

-- TimescaleDB is not available on Cloud SQL; using plain PostgreSQL + PostGIS
-- PostGIS is created by the apply script as the postgres/cloudsqlsuperuser

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
    basin_id    BIGINT,                    -- HydroBASINS HYBAS_ID (Level 7)
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
CREATE INDEX IF NOT EXISTS idx_gauge_readings_time ON gauge_readings (time DESC);
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
CREATE INDEX IF NOT EXISTS idx_met_readings_time ON met_readings (time DESC);
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
CREATE INDEX IF NOT EXISTS idx_flood_features_time ON flood_features (time DESC);
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
CREATE INDEX IF NOT EXISTS idx_flood_predictions_time ON flood_predictions (time DESC);
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

-- Community-submitted, anonymous flood incident reports
CREATE TABLE IF NOT EXISTS flood_incident_reports (
    id             BIGSERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location_name  TEXT NOT NULL,
    affected_street TEXT,
    flood_source   TEXT,
    incident_type  TEXT NOT NULL,
    severity       TEXT NOT NULL,
    description    TEXT NOT NULL,
    water_depth_cm DOUBLE PRECISION,
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    media_url      TEXT,
    media_type     TEXT,
    edit_token_hash TEXT,
    updated_at     TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'unverified'
);
CREATE INDEX IF NOT EXISTS idx_flood_incident_reports_created
    ON flood_incident_reports (created_at DESC);
-- ─── Flood risk polygons (SAR/DEM inundation or synthetic fallback) ──
CREATE TABLE IF NOT EXISTS flood_risk_areas (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    admin_level  TEXT NOT NULL DEFAULT 'inundation',  -- inundation | state | lga
    state        TEXT,
    geom         GEOMETRY(MultiPolygon, 4326) NOT NULL,
    risk_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_tier    TEXT NOT NULL,   -- Very High / High / Moderate (or urban Likely / Highly Likely; legacy Watch/Warning/…)
    source       TEXT NOT NULL,   -- sar_dem_inundation | urban_flash_flood | synthetic | sentinel1
    valid_from   DATE,
    valid_to     DATE,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_risk_areas_source
    ON flood_risk_areas (source, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_flood_risk_areas_tier
    ON flood_risk_areas (risk_tier);
CREATE INDEX IF NOT EXISTS idx_flood_risk_areas_geom
    ON flood_risk_areas USING GIST (geom);

-- ─── Raster tile registry (MinIO COGs served via TiTiler) ─────
CREATE TABLE IF NOT EXISTS flood_risk_tiles (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,   -- sar_dem_inundation | gee_susceptibility_classes | jrc_occurrence
    label        TEXT NOT NULL,
    minio_path   TEXT NOT NULL,
    tile_url     TEXT,
    valid_from   DATE,
    valid_to     DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_risk_tiles_source
    ON flood_risk_tiles (source, valid_from DESC);

-- ─── Urban built-up footprints (GEE monthly; used by flash-flood model) ──
CREATE TABLE IF NOT EXISTS urban_footprints (
    id               SERIAL PRIMARY KEY,
    name             TEXT NOT NULL,
    state            TEXT,
    geom             GEOMETRY(MultiPolygon, 4326) NOT NULL,
    centroid_lat     DOUBLE PRECISION NOT NULL,
    centroid_lon     DOUBLE PRECISION NOT NULL,
    area_km2         DOUBLE PRECISION NOT NULL DEFAULT 0,
    impervious_frac  DOUBLE PRECISION NOT NULL DEFAULT 0,
    flat_frac        DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_urban_footprints_geom
    ON urban_footprints USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_urban_footprints_centroid
    ON urban_footprints (centroid_lat, centroid_lon);

-- ─── Developer API subscribers / keys ─────────────────────────
CREATE TABLE IF NOT EXISTS api_subscribers (
    id           BIGSERIAL PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    org_name     TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_subscribers_status_chk CHECK (status IN ('active', 'suspended'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id                  BIGSERIAL PRIMARY KEY,
    key_id              TEXT NOT NULL UNIQUE,
    key_prefix          TEXT NOT NULL,
    key_hash            TEXT NOT NULL UNIQUE,
    subscriber_id       BIGINT NOT NULL REFERENCES api_subscribers(id) ON DELETE CASCADE,
    plan                TEXT NOT NULL DEFAULT 'free',
    env                 TEXT NOT NULL DEFAULT 'live',
    rate_limit_per_min  INTEGER NOT NULL DEFAULT 60,
    daily_quota         INTEGER NOT NULL DEFAULT 10000,
    revoked_at          TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT api_keys_plan_chk CHECK (plan IN ('free')),
    CONSTRAINT api_keys_env_chk CHECK (env IN ('live', 'test'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_subscriber
    ON api_keys (subscriber_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
    ON api_keys (key_prefix);

CREATE TABLE IF NOT EXISTS api_usage_daily (
    subscriber_id  BIGINT NOT NULL REFERENCES api_subscribers(id) ON DELETE CASCADE,
    day            DATE NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (subscriber_id, day)
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

-- ─── Seed: 21 basin-expansion gauge stations (5 + 21 = 26 total) ──
-- Covers all major Nigerian river basins: Niger, Benue, Kaduna,
-- Cross River, Anambra, Ogun, Hadejia, Komadugu Yobe, Rima, Gongola,
-- Osun, Imo, Zamfara, Katsina Ala.
INSERT INTO gauge_stations (code, name, river, state, lat, lon, bank_full_m, geom)
VALUES
  ('NIGER_JEB',  'Jebba Dam',         'Niger',         'Kwara',        9.1167,  4.8167, 15.0, ST_SetSRID(ST_MakePoint( 4.8167,  9.1167), 4326)),
  ('NIGER_KAI',  'Kainji Downstream', 'Niger',         'Niger',       10.3667,  4.6333, 16.5, ST_SetSRID(ST_MakePoint( 4.6333, 10.3667), 4326)),
  ('NIGER_IDA',  'Idah Crossing',     'Niger',         'Kogi',         7.1000,  6.7333, 13.5, ST_SetSRID(ST_MakePoint( 6.7333,  7.1000), 4326)),
  ('NIGER_ASA',  'Asaba',             'Niger',         'Delta',        6.2034,  6.7260, 11.0, ST_SetSRID(ST_MakePoint( 6.7260,  6.2034), 4326)),
  ('BENUE_MAK',  'Makurdi',           'Benue',         'Benue',        7.7316,  8.5213, 11.5, ST_SetSRID(ST_MakePoint( 8.5213,  7.7316), 4326)),
  ('BENUE_IBI',  'Ibi',               'Benue',         'Taraba',       8.1833,  9.7333,  9.0, ST_SetSRID(ST_MakePoint( 9.7333,  8.1833), 4326)),
  ('BENUE_NUM',  'Numan',             'Benue',         'Adamawa',      9.4667, 12.0333,  8.5, ST_SetSRID(ST_MakePoint(12.0333,  9.4667), 4326)),
  ('KADUNA_SHI', 'Shiroro Dam',       'Kaduna',        'Niger',       10.5000,  6.8333,  7.5, ST_SetSRID(ST_MakePoint( 6.8333, 10.5000), 4326)),
  ('KADUNA_KAD', 'Kaduna City',       'Kaduna',        'Kaduna',      10.5272,  7.4424,  6.5, ST_SetSRID(ST_MakePoint( 7.4424, 10.5272), 4326)),
  ('CROSS_IKO',  'Ikom',              'Cross River',   'Cross River',  5.9618,  8.7087,  8.5, ST_SetSRID(ST_MakePoint( 8.7087,  5.9618), 4326)),
  ('CROSS_CAL',  'Calabar',           'Cross River',   'Cross River',  4.9481,  8.3220,  7.0, ST_SetSRID(ST_MakePoint( 8.3220,  4.9481), 4326)),
  ('ANAM_OTU',   'Otuocha',           'Anambra',       'Anambra',      6.5000,  6.8333,  8.0, ST_SetSRID(ST_MakePoint( 6.8333,  6.5000), 4326)),
  ('OGUN_ABE',   'Abeokuta',          'Ogun',          'Ogun',         7.1475,  3.3508,  6.0, ST_SetSRID(ST_MakePoint( 3.3508,  7.1475), 4326)),
  ('HADEJIA_HAD','Hadejia',           'Hadejia',       'Jigawa',      12.4544, 10.0456,  4.5, ST_SetSRID(ST_MakePoint(10.0456, 12.4544), 4326)),
  ('YOBE_GAS',   'Gashua',            'Komadugu Yobe', 'Yobe',        12.8700, 11.0500,  4.0, ST_SetSRID(ST_MakePoint(11.0500, 12.8700), 4326)),
  ('SOKOTO_ARG', 'Argungu',           'Rima',          'Kebbi',       12.7447,  4.5232,  5.5, ST_SetSRID(ST_MakePoint( 4.5232, 12.7447), 4326)),
  ('GONG_YOL',   'Yola',              'Benue/Gongola', 'Adamawa',      9.2035, 12.4954,  7.5, ST_SetSRID(ST_MakePoint(12.4954,  9.2035), 4326)),
  ('OSUN_OSO',   'Osogbo',            'Osun',          'Osun',         7.7826,  4.5418,  5.0, ST_SetSRID(ST_MakePoint( 4.5418,  7.7826), 4326)),
  ('IMO_OWE',    'Owerri',            'Imo',           'Imo',          5.4836,  7.0331,  4.5, ST_SetSRID(ST_MakePoint( 7.0331,  5.4836), 4326)),
  ('ZAMFARA_GUS','Gusau',             'Zamfara',       'Zamfara',     12.1704,  6.6644,  4.0, ST_SetSRID(ST_MakePoint( 6.6644, 12.1704), 4326)),
  ('KATALA_TAK', 'Takum',             'Katsina Ala',   'Taraba',       7.2647,  9.9736,  6.5, ST_SetSRID(ST_MakePoint( 9.9736,  7.2647), 4326))
ON CONFLICT (code) DO NOTHING;

-- ─── Seed: 25 catchment/city met stations (4 + 25 = 29 total) ─────
-- One rainfall sampling point per basin gauge, plus strategic cities.
INSERT INTO met_stations (code, name, lat, lon, geom)
VALUES
  ('MET_JEBBA',    'Jebba Catchment',    9.1167,  4.8167, ST_SetSRID(ST_MakePoint( 4.8167,  9.1167), 4326)),
  ('MET_KAINJI',   'Kainji Catchment',  10.3667,  4.6333, ST_SetSRID(ST_MakePoint( 4.6333, 10.3667), 4326)),
  ('MET_IDAH',     'Idah Catchment',     7.1000,  6.7333, ST_SetSRID(ST_MakePoint( 6.7333,  7.1000), 4326)),
  ('MET_ASABA',    'Asaba Catchment',    6.2034,  6.7260, ST_SetSRID(ST_MakePoint( 6.7260,  6.2034), 4326)),
  ('MET_MAKURDI',  'Makurdi Catchment',  7.7316,  8.5213, ST_SetSRID(ST_MakePoint( 8.5213,  7.7316), 4326)),
  ('MET_IBI',      'Ibi Catchment',      8.1833,  9.7333, ST_SetSRID(ST_MakePoint( 9.7333,  8.1833), 4326)),
  ('MET_NUMAN',    'Numan Catchment',    9.4667, 12.0333, ST_SetSRID(ST_MakePoint(12.0333,  9.4667), 4326)),
  ('MET_SHIRORO',  'Shiroro Catchment', 10.5000,  6.8333, ST_SetSRID(ST_MakePoint( 6.8333, 10.5000), 4326)),
  ('MET_IKOM',     'Ikom Catchment',     5.9618,  8.7087, ST_SetSRID(ST_MakePoint( 8.7087,  5.9618), 4326)),
  ('MET_CALABAR',  'Calabar Catchment',  4.9481,  8.3220, ST_SetSRID(ST_MakePoint( 8.3220,  4.9481), 4326)),
  ('MET_OTUOCHA',  'Otuocha Catchment',  6.5000,  6.8333, ST_SetSRID(ST_MakePoint( 6.8333,  6.5000), 4326)),
  ('MET_ABEOK',    'Abeokuta Catchment', 7.1475,  3.3508, ST_SetSRID(ST_MakePoint( 3.3508,  7.1475), 4326)),
  ('MET_HADEJIA',  'Hadejia Catchment', 12.4544, 10.0456, ST_SetSRID(ST_MakePoint(10.0456, 12.4544), 4326)),
  ('MET_GASHUA',   'Gashua Catchment',  12.8700, 11.0500, ST_SetSRID(ST_MakePoint(11.0500, 12.8700), 4326)),
  ('MET_ARGUNGU',  'Argungu Catchment', 12.7447,  4.5232, ST_SetSRID(ST_MakePoint( 4.5232, 12.7447), 4326)),
  ('MET_YOLA',     'Yola Catchment',     9.2035, 12.4954, ST_SetSRID(ST_MakePoint(12.4954,  9.2035), 4326)),
  ('MET_OSOGBO',   'Osogbo Catchment',   7.7826,  4.5418, ST_SetSRID(ST_MakePoint( 4.5418,  7.7826), 4326)),
  ('MET_OWERRI',   'Owerri Catchment',   5.4836,  7.0331, ST_SetSRID(ST_MakePoint( 7.0331,  5.4836), 4326)),
  ('MET_GUSAU',    'Gusau Catchment',   12.1704,  6.6644, ST_SetSRID(ST_MakePoint( 6.6644, 12.1704), 4326)),
  ('MET_TAKUM',    'Takum Catchment',    7.2647,  9.9736, ST_SetSRID(ST_MakePoint( 9.9736,  7.2647), 4326)),
  ('MET_MAIDUGURI','Maiduguri',         11.8460, 13.1571, ST_SetSRID(ST_MakePoint(13.1571, 11.8460), 4326)),
  ('MET_SOKOTO',   'Sokoto City',       13.0622,  5.2339, ST_SetSRID(ST_MakePoint( 5.2339, 13.0622), 4326)),
  ('MET_BENIN',    'Benin City',         6.3350,  5.6270, ST_SetSRID(ST_MakePoint( 5.6270,  6.3350), 4326)),
  ('MET_ENUGU',    'Enugu',              6.4584,  7.5464, ST_SetSRID(ST_MakePoint( 7.5464,  6.4584), 4326)),
  ('MET_KADUNA',   'Kaduna City',       10.5105,  7.4165, ST_SetSRID(ST_MakePoint( 7.4165, 10.5105), 4326))
ON CONFLICT (code) DO NOTHING;

-- ─── Materialized views for dashboard queries (Cloud SQL) ─────
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
    ON rainfall_daily (bucket, station_id);
