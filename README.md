# Nigeria Flood Prediction Dashboard — Local Dev

## Prerequisites

```bash
# Copy the env template and fill in secrets (DB, JWT, GEE, optional SMS)
cp .env.example .env

# For the Google Earth Engine layers, drop your service-account key JSON
# into the repo root and point .env at it:
#   GEE_SERVICE_ACCOUNT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
#   GEE_SERVICE_ACCOUNT_KEY=./your-key-file.json
```

> **Note for fresh clones:** `.env` and the GEE `*.json` key files are
> gitignored, so they are **not** in the repo — copy them over manually.
> Everything else (all 26 gauge + 29 met station definitions, exposure
> layers, and code) comes with the clone.

## Quick Start

```bash
# 1. Start all services
#    On first run, TimescaleDB auto-seeds the full station network via
#    infra/timescaledb/init.sql: 26 gauge stations + 29 met stations
#    across all major Nigerian river basins.
docker-compose up -d

# 2. Wait ~60 s for TimescaleDB to init, then backfill 90 days of history
docker-compose run --rm ingest python backfill.py

# 3. Start the Flink feature engineering job (standalone mode for local dev)
docker-compose exec flink-jobmanager python /opt/flink/jobs/flood_features.py --standalone &

# 4. Train ML models (needs ~500+ feature rows — takes 2-3 min)
docker-compose run --rm bentoml python train.py

# 5. Open the dashboard
open http://localhost:5173
```

## Real data & enrichment (optional)

The geospatial flood map uses SAR+DEM inundation, urban flash-flood,
inundation-history, and susceptibility products; it does not fall back to
synthetic state polygons. To refresh these products, run the following against the running stack (same
`docker-compose run --rm ingest python <script>` pattern):

| Script | What it does | Needs |
|--------|--------------|-------|
| `ingest/flood_risk/real_data.py` | Live weather/rainfall per station from Open-Meteo | network |
| `ingest/flood_risk/gee_flood_risk.py` | Inundation History (JRC Landsat) + Flood Susceptibility (JRC + HAND + distance-to-drainage + slope) COGs | GEE creds |
| `ingest/flood_risk/inundation_extent.py` | SAR+DEM inundation probability (Very High / High / Moderate) | GEE creds |
| `ingest/flood_risk/urban_footprints.py` | Urban built-up footprints for flash-flood model | GEE creds |
| `ingest/flood_risk/urban_flash_flood.py` | Short-range urban flash-flood alerts (Open-Meteo rainfall) | network |
| `ingest/flood_risk/sentinel1_flood.py` | Sentinel-1 SAR flood extent (legacy/state summaries) | GEE creds |
| `ingest/exposure/fetch_osm_exposure.py` | Roads / bridges / places exposure from OSM | network |
| `ingest/expand_stations.py` | Top up stations on an **already-running** DB (init.sql already seeds all 26/29 on a fresh volume) | — |

## Map modes

| Mode | Audience | What you get |
|------|----------|--------------|
| **Public** | Communities & responders | Place search, early-warning outlook, nearby towns/roads/buildings at risk |
| **Expert** | Hydrologists & ops | Gauge triage (search/sort/filter), network risk overview, stage vs bankfull, multi-horizon forecasts, hydrographs |

Toggle Public / Expert in the header. Expert never starts blank — the right rail shows a network overview until a gauge is selected.

### Map layers (dashboard)

| Layer | Meaning |
|-------|---------|
| Inundation probability | Current/near-term riverine extents (SAR + DEM floodplain) |
| Urban flash flood | 24h rainfall over built-up areas (Likely / Highly likely) |
| Inundation History | How often land was wet, JRC Landsat 1984–2021 (5–25% / 25–50% / >50%) |
| Flood Susceptibility | Static predisposition: JRC 40% + HAND 30% + distance to drainage 20% + slope 10% |
| River basins | HydroBASINS Level 7 watersheds; selecting a gauge highlights its catchment |

After overwriting a COG in MinIO, restart TiTiler so tiles do not serve a stale cache:

```bash
docker restart flood_titiler
```

## Service URLs

| Service       | URL                          |
|---------------|------------------------------|
| Dashboard     | http://localhost:5173        |
| API docs      | http://localhost:8000/docs   |
| MLflow UI     | http://localhost:5000        |
| Flink UI      | http://localhost:8081        |
| MinIO console | http://localhost:9001        |
| Grafana       | http://localhost:3001        |
| Prometheus    | http://localhost:9090        |

## Architecture (local)

```
Cloud Scheduler → [APScheduler in ingest container]
                         │
              ┌──────────┴──────────┐
         Gauges (5 min)       Met (15 min)
              └──────────┬──────────┘
                         ▼
                   TimescaleDB
                   (+ PostGIS)
                         │
               Flink feature job (30 s poll)
                         │
                  flood_features table
                         │
               BentoML /predict (XGBoost+LSTM)
                         │
                      FastAPI
                         │
                    React SPA
                  (MapLibre + ECharts)
```

## Data flow after `docker-compose up`

1. **ingest** container generates synthetic gauge + met readings continuously.
2. **Flink job** (run manually step 3 above) polls TimescaleDB and writes `flood_features`.
3. **train.py** trains XGBoost + LSTM on 90 days of backfilled features.
4. **BentoML** serves the trained models at port 3000.
5. **FastAPI** queries features → calls BentoML → returns predictions to frontend.
6. **React** renders risk map, charts, and alert banner live via WebSocket.

## Dev credentials

| Service | Username | Password  |
|---------|----------|-----------|
| API JWT | admin    | admin123  |
| API JWT | viewer   | viewer123 |
| Grafana | admin    | admin     |
| MinIO   | minioadmin | minioadmin |

## Re-training

```bash
# Retrain all horizons
docker-compose run --rm bentoml python train.py

# Retrain only 24h horizon
docker-compose run --rm bentoml python train.py --horizon 24
```
