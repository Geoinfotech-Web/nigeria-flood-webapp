-- Migration: urban footprints for short-range flash-flood model (safe to re-run)
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
