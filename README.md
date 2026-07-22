# GGIS Flood Watch (Nigeria Flood Dashboard)

Local development stack and pointers for the live GCP deployment.

## Prerequisites

```bash
# Copy the env template and fill in secrets (DB, JWT, GEE, optional SMS)
cp .env.example .env

# For the Google Earth Engine layers, drop your service-account key JSON
# into the repo root and point .env at it:
#   GEE_SERVICE_ACCOUNT_EMAIL=your-sa@your-project.iam.gserviceaccount.com
#   GEE_SERVICE_ACCOUNT_KEY=./your-key-file.json
#
# For fresher place search + nearby towns/villages, enable **Places API**
# (legacy Text Search / Nearby Search) in Google Cloud and set:
#   GOOGLE_MAPS_API_KEY=your-key
# Optional: enable **Geocoding API** (better reverse) and **Map Tiles API**
# (Google roadmap / satellite basemap in the map switcher).
# When unset, place search falls back to Nominatim / OSM.
```

> **Note for fresh clones:** `.env` and the GEE `*.json` key files are
> gitignored, so they are **not** in the repo — copy them over manually.
> Everything else (all 26 gauge + 29 met station definitions, exposure
> layers, and code) comes with the clone.

## Quick Start (local)

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

## Live GCP deployment (temporary URLs)

Production project **`ggis-flood-watch`** (`europe-west1`) is up on temporary endpoints while custom domains (`gfw.ggis.africa` / `api.gfw.ggis.africa`) are prepared by the web team.

| Surface | URL |
|---------|-----|
| Frontend (Firebase Hosting) | https://ggis-flood-watch.web.app |
| API (Cloud Run `gfw-api`) | https://gfw-api-883584176276.europe-west1.run.app |
| API docs | https://gfw-api-883584176276.europe-west1.run.app/docs |
| ML (Cloud Run `gfw-ml`) | BentoML behind `BENTOML_URL` on the API |
| TiTiler (Cloud Run `gfw-titiler`) | COG tiles for susceptibility / inundation history |

| Backend | Resource |
|---------|----------|
| Database | Cloud SQL `gfw-postgres` (DB `flooddb`, PostGIS) |
| Rasters | GCS `gs://gfw-flood-rasters-ggis-flood-watch/` → `flood_risk_tiles` |
| Secrets | Secret Manager (`DB_*`, `JWT_SECRET`, `GOOGLE_MAPS_API_KEY`, GEE SA) |

**Cloud data policy:** Cloud SQL uses **real OpenMeteo / GloFAS only** (synthetic history purged). Features and XGB+LSTM models were trained on that real series.

### Redeploy cheat sheet

```bash
# API image → Artifact Registry → Cloud Run
gcloud auth configure-docker europe-west1-docker.pkg.dev
docker build -t europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest ./api
docker push europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest
gcloud run deploy gfw-api \
  --image europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest \
  --region europe-west1 \
  --env-vars-file scripts/api_env.yaml \
  --set-secrets "JWT_SECRET=JWT_SECRET:latest,DB_USER=DB_USER:latest,DB_PASSWORD=DB_PASSWORD:latest,DB_NAME=DB_NAME:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest" \
  --add-cloudsql-instances ggis-flood-watch:europe-west1:gfw-postgres \
  --allow-unauthenticated --port 8080 --memory 1Gi --quiet

# Frontend → Firebase Hosting (uses frontend/.env.production)
cd frontend && npm run build && cd ..
python scripts/deploy_firebase_hosting.py
```

More detail: `CLOUD_RUN_API.md`, `GCP_HOSTING_RUNBOOK.md`, and helpers under `scripts/` (`seed_cloud_sql_real.py`, `seed_cloud_raster_tiles.py`, `migrate_flood_risk_areas.py`, `deploy_cloud_ml.py`, `apply_incident_verification.py`).

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
| `ingest/flood_risk/urban_footprints.py` | Urban built-up footprints; names from OSM places + LGA (`--rename-only` to relabel without GEE) | GEE / local data |
| `ingest/flood_risk/urban_flash_flood.py` | Short-range urban flash-flood alerts (Open-Meteo rainfall) | network |
| `ingest/flood_risk/sentinel1_flood.py` | Sentinel-1 SAR flood extent (legacy/state summaries) | GEE creds |
| `ingest/exposure/fetch_osm_exposure.py` | Roads / bridges / places exposure from OSM | network |
| `ingest/expand_stations.py` | Top up stations on an **already-running** DB (init.sql already seeds all 26/29 on a fresh volume) | — |

Urban flash polygons show place names (e.g. `Pulka, Borno`), not `Urban cluster N`.

## Map modes

| Mode | Audience | What you get |
|------|----------|--------------|
| **Public** | Communities & responders | Place search, early-warning outlook, nearby towns/roads/buildings at risk |
| **Expert** | Hydrologists & ops | Gauge triage (search/sort/filter), network risk overview, stage vs bankfull, multi-horizon forecasts, hydrographs, community report verification |

Toggle Public / Expert in the header. Expert never starts blank — the right rail shows a network overview until a gauge is selected.

### Map layers (dashboard)

| Layer | Meaning |
|-------|---------|
| Inundation probability | Current/near-term riverine extents (SAR + DEM floodplain) |
| Urban flash flood | 24h rainfall over built-up areas (Likely / Highly likely), labeled by place |
| Inundation History | How often land was wet, JRC Landsat 1984–2021 (5–25% / 25–50% / >50%) |
| Flood Susceptibility | Static predisposition: JRC 40% + HAND 30% + distance to drainage 20% + slope 10% |
| River basins | HydroBASINS Level 7 watersheds; selecting a gauge highlights its catchment |
| Google roadmap / satellite | Optional basemaps when `GOOGLE_MAPS_API_KEY` is set |
| Community flood reports | Submit + peer verify (2 nearby verifications → verified) |

After overwriting a COG in MinIO (local), restart TiTiler so tiles do not serve a stale cache:

```bash
docker restart flood_titiler
```

## Service URLs (local)

| Service       | URL                          |
|---------------|------------------------------|
| Dashboard     | http://localhost:5173        |
| API docs      | http://localhost:8000/docs   |
| MLflow UI     | http://localhost:5000        |
| Flink UI      | http://localhost:8081        |
| MinIO console | http://localhost:9001        |
| Grafana       | http://localhost:3002        |
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

1. **ingest** container generates synthetic gauge + met readings continuously (local bootstrap).
2. **Flink job** (run manually step 3 above) polls TimescaleDB and writes `flood_features`.
3. **train.py** trains XGBoost + LSTM on 90 days of backfilled features.
4. **BentoML** serves the trained models at port 3000.
5. **FastAPI** queries features → calls BentoML → returns predictions to frontend.
6. **React** renders risk map, charts, and alert banner live via WebSocket.

On **GCP**, step 1 is replaced by real OpenMeteo/GloFAS seeding (`scripts/seed_cloud_sql_real.py`); synthetic history is not kept in Cloud SQL.

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

# Against Cloud SQL + redeploy ML (see scripts/deploy_cloud_ml.py)
python scripts/deploy_cloud_ml.py
```
