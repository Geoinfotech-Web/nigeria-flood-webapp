-- Migration: flood risk / inundation tables (safe to re-run)
CREATE TABLE IF NOT EXISTS flood_risk_areas (
    id           SERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    admin_level  TEXT NOT NULL DEFAULT 'inundation',
    state        TEXT,
    geom         GEOMETRY(MultiPolygon, 4326) NOT NULL,
    risk_score   DOUBLE PRECISION NOT NULL DEFAULT 0,
    risk_tier    TEXT NOT NULL,
    source       TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS flood_risk_tiles (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    label        TEXT NOT NULL,
    minio_path   TEXT NOT NULL,
    tile_url     TEXT,
    valid_from   DATE,
    valid_to     DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flood_risk_tiles_source
    ON flood_risk_tiles (source, valid_from DESC);
