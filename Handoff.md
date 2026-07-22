# GGIS Flood Watch — Developer Handoff

**Date:** 22 July 2026  
**Status:** Local stack operational. **GCP staging live** on temporary URLs (Firebase + Cloud Run + Cloud SQL). Real OpenMeteo/GloFAS data on cloud; colleague community-report verification merged and deployed.

---

## What This System Does

A full-stack flood prediction and monitoring dashboard for Nigeria (product name **GGIS Flood Watch**). It pulls live river discharge data from GloFAS (via OpenMeteo) and meteorological data from OpenMeteo for 26 gauge stations and 29 met stations distributed across all major Nigerian river basins. Machine learning models (XGBoost + LSTM) forecast flood probability at 6, 12, 24, 48, and 72 hour horizons.

Geospatial flood layers include:

- **Inundation probability** — Sentinel-1 SAR change detection + DEM floodplain (Very High / High / Moderate)
- **Inundation History** — JRC Global Surface Water (Landsat) occurrence classes (5–25% / 25–50% / >50%)
- **Flood Susceptibility** — static predisposition score: **JRC 40% + HAND 30% + distance to drainage 20% + slope 10%**
- **Urban flash flood** — short-range Open-Meteo rainfall over ESA WorldCover built-up footprints, labeled by **place / LGA name** (not cluster IDs)

Everything is displayed on an interactive MapLibre map with real-time WebSocket updates, place outlook, exposure (roads/bridges/settlements/buildings), routing, Google roadmap/satellite basemaps (when keyed), community incident reporting, and **peer verification** of reports.

**Public mode** is place-centric early warning (search a town, see outlook and nearby exposure). **Expert mode** is a hydrologist console: network risk overview, gauge triage (search/sort/filter by risk and river), stage vs bankfull, multi-horizon forecasts, hydrographs, and community-report analytics.

---

## System State Summary

### Local Docker Compose

| Component | State | Notes |
|---|---|---|
| Docker Compose stack | Running | Core containers healthy |
| TimescaleDB | Populated | Backfill + real ingest available |
| Gauge stations | 26 active | `basin_id` assigned (HydroBASINS L7) |
| Met stations | 29 active | One catchment point per gauge + strategic cities |
| Feature table | Populated | Used for XGBoost / LSTM training |
| ML models | Registered | xgb_h6/12/24/48/72; lstm_h48/h72 when gates pass |
| Inundation History COG | Active | JRC Landsat classes → MinIO → TiTiler |
| Flood Susceptibility COG | Active | JRC + HAND + drainage distance + slope |
| SAR+DEM inundation | Active | Vector polygons in `flood_risk_areas` |
| Urban flash flood | Active | Place-named alerts (e.g. Pulka, Borno) |
| Community reports | Active | Verification table + API (`/incidents/{id}/verify`) |
| Frontend | Live | http://localhost:5173 |

### GCP (`ggis-flood-watch`, `europe-west1`)

| Component | State | Notes |
|---|---|---|
| Cloud SQL `gfw-postgres` | Live | DB `flooddb`; real readings only (synthetic purged) |
| Cloud Run `gfw-api` | Live | https://gfw-api-883584176276.europe-west1.run.app |
| Cloud Run `gfw-ml` | Live | BentoML; wired via `BENTOML_URL` |
| Cloud Run `gfw-titiler` | Live | Reads GCS COGs via GEE SA mount |
| GCS rasters | Live | `gs://gfw-flood-rasters-ggis-flood-watch/` |
| Firebase Hosting | Live | https://ggis-flood-watch.web.app |
| CORS | Configured | `gfw.ggis.africa` + Firebase origins |
| Custom domains | Pending | Web team: `gfw.ggis.africa` / `api.gfw.ggis.africa` |

---

## Repository Layout

```
Nigeria Flood Dashboard/
├── docker-compose.yml          — full local stack
├── .env                        — secrets + overrides (git-ignored)
├── *.json                      — GEE service account key (git-ignored)
│
├── infra/
│   └── timescaledb/
│       ├── init.sql            — schema + station seed (+ incident verification)
│       ├── init_cloud_sql.sql  — Cloud SQL–friendly schema (no Timescale)
│       └── migrations/
│
├── ingest/
│   ├── main.py                 — APScheduler entrypoint
│   ├── backfill.py             — local history bootstrap
│   ├── expand_stations.py
│   ├── boundaries/             — HydroBASINS fetch + gauge basin assign
│   └── flood_risk/
│       ├── real_data.py        — OpenMeteo + GloFAS ingest
│       ├── gee_flood_risk.py   — Inundation History + susceptibility COGs
│       ├── inundation_extent.py
│       ├── urban_footprints.py — clusters + place/LGA naming (`--rename-only`)
│       ├── urban_flash_flood.py
│       └── ...
│
├── flink/jobs/
│   ├── flood_features.py
│   ├── backfill_features.py
│   └── fast_features_real.py   — faster real-feature build helper
│
├── ml/
│   ├── train.py
│   ├── Dockerfile / Dockerfile.cloudrun
│   └── service.py
│
├── api/
│   ├── main.py                 — Cloud SQL socket + CORS + optional Redis
│   ├── Dockerfile              — Cloud Run production image
│   └── routers/
│       ├── flood_risk.py
│       ├── incidents.py        — create / list / edit / verify reports
│       ├── map_router.py       — Google style HTTPS tiles
│       └── ...
│
├── frontend/
│   ├── .env.production         — VITE_API_URL / VITE_WS_URL → Cloud Run
│   └── src/components/         — MapPanel, LayersPanel, verification UI, …
│
├── scripts/                    — GCP ops helpers (seed, migrate, deploy)
├── CLOUD_RUN_API.md
├── GCP_HOSTING_RUNBOOK.md
├── AWS_HOSTING_RUNBOOK.md      — alternate hosting path for web team
├── CONTEXT.md                  — full technical reference
├── README.md                   — quick start + live URLs
└── Handoff.md                  — this file
```

---

## GCP Operations (current)

### Temporary public endpoints

- Frontend: https://ggis-flood-watch.web.app  
- API: https://gfw-api-883584176276.europe-west1.run.app  
- Docs: https://gfw-api-883584176276.europe-west1.run.app/docs  

### Useful scripts

| Script | Purpose |
|--------|---------|
| `scripts/seed_cloud_sql_real.py` | Purge synthetic; seed real GloFAS/OpenMeteo via Auth Proxy |
| `scripts/seed_cloud_raster_tiles.py` | Upload COGs to GCS; register `flood_risk_tiles` |
| `scripts/migrate_flood_risk_areas.py` | Copy inundation + urban flash polygons local → Cloud SQL |
| `scripts/deploy_cloud_ml.py` | Train against Cloud SQL; deploy `gfw-ml` |
| `scripts/deploy_firebase_hosting.py` | Upload `frontend/dist` to Firebase Hosting |
| `scripts/apply_cloud_sql_init.py` | Apply Cloud SQL schema |
| `scripts/apply_incident_verification.py` | Add verification columns/table on Cloud SQL |
| `scripts/api_env.yaml` | Cloud Run env (CORS, BentoML, TiTiler, public API base) |

### Redeploy API

```bash
docker build -t europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest ./api
docker push europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest
gcloud run deploy gfw-api \
  --image europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest \
  --region europe-west1 \
  --env-vars-file scripts/api_env.yaml \
  --set-secrets "JWT_SECRET=JWT_SECRET:latest,DB_USER=DB_USER:latest,DB_PASSWORD=DB_PASSWORD:latest,DB_NAME=DB_NAME:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest" \
  --add-cloudsql-instances ggis-flood-watch:europe-west1:gfw-postgres \
  --allow-unauthenticated --port 8080 --memory 1Gi --quiet
```

### Redeploy frontend

```bash
cd frontend && npm run build && cd ..
python scripts/deploy_firebase_hosting.py
```

### Urban flash place names

Footprints and alerts are named from OSM places (`api/data/exposure_places.geojson`) with LGA/state fallback (`admin_lgas.geojson`).

```bash
# Relabel existing footprints + sync urban_flash_flood rows (no GEE)
DB_HOST=… python ingest/flood_risk/urban_footprints.py --rename-only
# Then re-migrate polygons to Cloud SQL if needed:
python scripts/migrate_flood_risk_areas.py
```

### Community report verification

- Schema: `reporter_token_hash` on `flood_incident_reports`; table `flood_incident_verifications`
- Rule: **2** verifications within **10 km** → status `verified`
- Editing a report clears verifications and resets status to `unverified`
- Apply on an existing Cloud SQL DB: `python scripts/apply_incident_verification.py`

---

## Flood Susceptibility Model (current)

Built in `ingest/flood_risk/gee_flood_risk.py` and exported as `gee_susceptibility_classes`:

| Factor | Weight | Direction |
|---|---|---|
| JRC water occurrence | 40% | Higher occurrence → higher susceptibility |
| HAND (height above drainage) | 30% | Lower HAND → higher (max useful range ~30 m) |
| Distance to drainage | 20% | Nearer to water/valley floors → higher (max ~5 km) |
| Slope | 10% | Flatter → higher |

HAND-lite = SRTM elevation minus 1 km focal minimum. Drainage mask = JRC occurrence ≥ 5% **or** HAND ≤ 3 m. Classes remain Low / Moderate / High / Highly Susceptible at 0–25 / 26–50 / 51–75 / >75.

**Inundation History** (same script): JRC-only classes Occasional 5–25%, Frequent 25–50%, Very frequent >50% — no Sentinel-1 blend.

Re-export (local MinIO):

```bash
docker exec flood_ingest python -m flood_risk.gee_flood_risk --mode monthly
docker restart flood_titiler   # required after overwriting COGs in MinIO
```

On GCP, upload COGs with `scripts/seed_cloud_raster_tiles.py` (bucket is private; TiTiler uses the GEE SA JSON mount — org policy may block public buckets / HMAC keys).

---

## Running the System (local)

### Start everything
```bash
docker-compose up -d
```
All containers come up healthy. TimescaleDB init runs automatically on first start.

### Check container status
```bash
docker-compose ps
docker-compose logs --tail=50 flood_api
docker-compose logs --tail=50 flood_bentoml
```

### Stop everything
```bash
docker-compose down
# To also wipe data volumes (destructive):
docker-compose down -v
```

---

## Key Operational Commands

### Re-run real data ingest (manual)
```bash
DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/real_data.py --once
```

### Re-export inundation history + susceptibility
```bash
docker exec flood_ingest python -m flood_risk.gee_flood_risk --mode monthly
docker restart flood_titiler
```

### Run SAR+DEM inundation extents
```bash
docker exec flood_ingest python -m flood_risk.inundation_extent
```

### Refresh urban footprints / flash-flood alerts
```bash
docker exec flood_ingest python -m flood_risk.urban_footprints
# Or rename only (uses api/data places + LGAs):
docker exec flood_ingest python -m flood_risk.urban_footprints --rename-only
docker exec flood_ingest python -m flood_risk.urban_flash_flood
```

### Retrain ML models
```bash
docker-compose run --rm bentoml python train.py
```
Takes ~10 minutes. Registers new model versions in BentoML if quality gates pass.

### Rebuild frontend after code changes
```bash
docker-compose up -d --build frontend
# Or if Vite HMR is working (usePolling: true):
# just save the file — changes reload automatically in browser
```

---

## Current Model Performance

Local and cloud models were last trained on feature rows from 26 gauge stations. **Cloud models use real GloFAS/OpenMeteo features only** (no synthetic history in Cloud SQL).

| Model | Notes |
|---|---|
| `xgb_h6` … `xgb_h72` | Primary short- and medium-range models |
| `lstm_h48`, `lstm_h72` | Used in ensemble when quality gates pass |

LSTM for 6h, 12h, 24h may still fail the F1 gate on thinner real series. XGBoost alone is used for those horizons. As real data accumulates, shorter-horizon LSTM should improve.

---

## What Is "Real" vs "Synthetic"

| Data type | Source | Real or synthetic |
|---|---|---|
| River discharge | GloFAS via OpenMeteo Flood API | Real (satellite-constrained hydrological model) |
| Rainfall, temperature, humidity | OpenMeteo Weather API | Real (NWP model, assimilated observations) |
| Inundation probability | Sentinel-1 + DEM via GEE | Real satellite + terrain |
| Inundation History | JRC GSW Landsat via GEE | Real historical satellite |
| Flood susceptibility | JRC + SRTM HAND/drainage via GEE | Real historical satellite + terrain hydrology |
| Urban flash flood | WorldCover + OpenMeteo rainfall | Real land cover + forecast rainfall |
| Initial 90-day history (local) | `backfill.py` | Synthetic — local bootstrap only |
| Cloud SQL history | `scripts/seed_cloud_sql_real.py` | **Real only** — synthetic purged |
| State-level synthetic risk polygons | Legacy only | Not scheduled or served by the API |

---

## Known Issues and Limitations

### LSTM short-horizon models not always registered
The 6h, 12h, 24h LSTM models may fail the F1 gate.

**Workaround:** XGBoost alone is sufficient for these horizons.

### Legacy synthetic state risk utility
`synthetic_flood_risk.py` remains in the repository for historical development only. The live scheduler and API do not use its state polygons.

### Rainfall is distance-weighted (IDW)
`rolling_rain_Xh_mm` uses inverse-distance weighting over the **k=5 nearest met stations within 250 km**. Magnitudes are much smaller than the old all-station sum — `soil_moisture_idx` still uses `/ 80` as a soft saturation proxy.

Implemented in `flink/jobs/idw_rainfall.py`, used by `flood_features.py` and `backfill_features.py`. Refresh existing rows with:
`python backfill_features.py --replace-rain` then retrain.

### HydroBASINS river-basin map layer
`api/data/basins.geojson` (HydroBASINS L7, clipped to Nigeria) is served via `/boundaries/basins`. Gauges store `basin_id`; selecting a station highlights its catchment on the map (LayersPanel toggle **River basins**). Regenerate with `python ingest/boundaries/fetch_hydrobasins.py`; reassign with `python ingest/boundaries/assign_gauge_basins.py`.

### No in-situ sensor data
All gauge and met data is from GloFAS and OpenMeteo — no physical sensors connected. NIHSA / NiMet APIs are not publicly accessible.

### TiTiler stale tiles after COG overwrite
Re-exporting a COG under the same MinIO key can leave TiTiler serving 500s or blank tiles for some XYZ cells.

**Fix:** `docker restart flood_titiler` after each overwrite (or version the filename).

### GCS / org policy (GCP)
Public bucket IAM and HMAC key creation may be blocked by organization policy. Current TiTiler path uses a mounted service-account JSON (`GOOGLE_APPLICATION_CREDENTIALS`) to read private GCS objects.

### Vite polling mode has ~300ms latency
`usePolling: true` in vite.config.js is a Docker-on-Windows filesystem limitation, not a code issue.

### Custom domains not yet attached
Temporary Firebase + Cloud Run URLs are live. Point `gfw.ggis.africa` / `api.gfw.ggis.africa` when DNS is ready; update `CORS_ORIGINS` / `PUBLIC_API_BASE_URL` / `frontend/.env.production` accordingly.

---

## Adding New Gauge Stations

1. Insert the station into the `gauge_stations` table:
```sql
INSERT INTO gauge_stations (code, name, river, state, lat, lon, bank_full_m, basin_id, geom)
VALUES ('MY_CODE', 'My Station', 'River Name', 'State', 7.5, 5.2, 8.0,
        NULL, ST_SetSRID(ST_MakePoint(5.2, 7.5), 4326));
```

2. Optionally add a catchment met station:
```sql
INSERT INTO met_stations (code, name, lat, lon, geom)
VALUES ('MET_MY', 'My Catchment', 7.5, 5.2,
        ST_SetSRID(ST_MakePoint(5.2, 7.5), 4326));
```

3. Assign basin: `python ingest/boundaries/assign_gauge_basins.py`

4. Real data ingest picks it up automatically on the next run — no code changes needed.

5. Retrain models after enough data has accumulated (suggest 2+ weeks):
```bash
docker-compose run --rm bentoml python train.py
# or on GCP: python scripts/deploy_cloud_ml.py
```

---

## Recommended Next Steps (Priority Order)

### 1. Attach custom domains
**Effort:** Low (web / DNS team)  
Map `gfw.ggis.africa` → Firebase, `api.gfw.ggis.africa` → Cloud Run; refresh CORS and frontend env; redeploy.

### 2. Schedule cloud ingest + monthly GEE re-export
**Effort:** Medium  
Cloud Scheduler → Cloud Run jobs for `real_data.py`, `urban_flash_flood.py`, `gee_flood_risk` / inundation; re-upload COGs to GCS.

### 3. Accumulate real data and retrain quarterly
**Effort:** Ongoing  
`python scripts/deploy_cloud_ml.py` (or local train) every ~3 months.

### 4. Constrain IDW rain to mets inside the selected basin (optional)
**Effort:** Low–medium  

### 5. Optional: full hydrologic HAND / flow-accumulation drainage
**Effort:** Medium  

### 6. NIHSA real gauge integration
**Effort:** Weeks (data agreement)  
Slot into `real_data.py` alongside OpenMeteo.

---

## GEE Credentials

The Google Earth Engine service account used for raster exports may be tied to a dedicated GEE/GCP project (key JSON in repo root, git-ignored). Cloud Run TiTiler and GEE jobs consume the key via Secret Manager / mounted file — do not commit keys.

If the key expires or is rotated, create a new key from the GCP Console under IAM → Service Accounts, update Secret Manager / local `.env`, and redeploy services that mount it.

---

## Support / Reference

| Resource | Location |
|---|---|
| Full technical reference | `CONTEXT.md` |
| Local quick start + live URLs | `README.md` |
| Cloud Run API deploy | `CLOUD_RUN_API.md` |
| GCP hosting runbook | `GCP_HOSTING_RUNBOOK.md` |
| AWS alternate runbook | `AWS_HOSTING_RUNBOOK.md` |
| Local API docs | http://localhost:8000/docs |
| Live API docs | https://gfw-api-883584176276.europe-west1.run.app/docs |
| Live app | https://ggis-flood-watch.web.app |
| MLflow experiments (local) | http://localhost:5000 |
| MinIO bucket browser (local) | http://localhost:9001 (minioadmin / minioadmin) |
| Grafana (local) | http://localhost:3002 (admin / admin) |
| OpenMeteo Flood API docs | https://open-meteo.com/en/docs/flood-api |
| GEE Python API docs | https://developers.google.com/earth-engine/guides/python_install |
| GADM Nigeria boundaries | https://gadm.org/download_country.html (select Nigeria, Level 1) |
