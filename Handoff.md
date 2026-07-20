# Nigeria Flood Dashboard — Developer Handoff

**Date:** July 2026  
**Status:** Local development complete. All services operational. Real data pipeline active. Flood susceptibility upgraded to HAND + drainage distance.

---

## What This System Does

A full-stack flood prediction and monitoring dashboard for Nigeria. It pulls live river discharge data from GloFAS (via OpenMeteo) and meteorological data from OpenMeteo for 26 gauge stations and 29 met stations distributed across all major Nigerian river basins. Machine learning models (XGBoost + LSTM) forecast flood probability at 6, 12, 24, 48, and 72 hour horizons.

Geospatial flood layers include:

- **Inundation probability** — Sentinel-1 SAR change detection + DEM floodplain (Very High / High / Moderate)
- **Inundation History** — JRC Global Surface Water (Landsat) occurrence classes (5–25% / 25–50% / >50%)
- **Flood Susceptibility** — static predisposition score: **JRC 40% + HAND 30% + distance to drainage 20% + slope 10%**
- **Urban flash flood** — short-range Open-Meteo rainfall over ESA WorldCover built-up footprints

Everything is displayed on an interactive MapLibre map with real-time WebSocket updates, place outlook, exposure (roads/bridges/settlements/buildings), routing, and community incident reporting.

**Public mode** is place-centric early warning (search a town, see outlook and nearby exposure). **Expert mode** is a hydrologist console: network risk overview, gauge triage (search/sort/filter by risk and river), stage vs bankfull, multi-horizon forecasts, and hydrographs.

---

## System State Summary

| Component | State | Notes |
|---|---|---|
| Docker Compose stack | Running | All core containers healthy |
| TimescaleDB | Populated | 90-day backfill + real data ingesting |
| Gauge stations | 26 active | All major Nigerian river basins covered |
| Met stations | 29 active | One catchment point per gauge + strategic cities |
| Feature table | Populated | Used for XGBoost / LSTM training |
| ML models | Registered | xgb_h6/12/24/48/72; lstm_h48/h72 when gates pass |
| Inundation History COG | Active | JRC Landsat classes @ ~250 m, MinIO → TiTiler |
| Flood Susceptibility COG | Active | JRC + HAND + drainage distance + slope @ ~1 km |
| SAR+DEM inundation | Active | Monthly via `inundation_extent.py` |
| Urban flash flood | Active | Every 3 hours via APScheduler |
| Real data ingest | Configured | Hourly via APScheduler inside `flood_ingest` |
| Frontend | Live | http://localhost:5173 |

---

## Repository Layout

```
Nigeria Flood Dashboard/
├── docker-compose.yml          — full stack definition
├── .env                        — secrets + overrides (git-ignored)
├── *.json                      — GEE service account key (git-ignored)
│
├── infra/
│   └── timescaledb/
│       ├── init.sql            — schema + station seed
│       └── migrations/         — incremental SQL (e.g. urban flash)
│
├── ingest/
│   ├── main.py                 — APScheduler entrypoint
│   ├── backfill.py             — 90-day synthetic history
│   ├── expand_stations.py      — optional station top-up
│   └── flood_risk/
│       ├── real_data.py        — OpenMeteo + GloFAS ingest
│       ├── gee_flood_risk.py   — Inundation History + susceptibility COGs
│       ├── inundation_extent.py — SAR+DEM Very High / High / Moderate
│       ├── urban_footprints.py — monthly urban clusters (GEE)
│       ├── urban_flash_flood.py — 3-hourly flash-flood classifier
│       ├── sentinel1_flood.py  — legacy SAR state summaries
│       └── synthetic_flood_risk.py — state-level synthetic fallback
│
├── flink/jobs/
│   ├── flood_features.py
│   └── backfill_features.py
│
├── ml/
│   └── train.py
│
├── api/
│   ├── main.py
│   └── routers/
│       ├── flood_risk.py       — GeoJSON, tile list, TiTiler proxy
│       └── ...
│
├── frontend/
│   └── src/components/
│       ├── MapPanel.jsx
│       ├── LayersPanel.jsx     — layer toggles (labels only, no hints)
│       ├── FloodRiskLegend.jsx
│       └── ...
│
├── CONTEXT.md                  — full technical reference
├── README.md                   — local quick start
└── Handoff.md                  — this file
```

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

Re-export:

```bash
docker exec flood_ingest python -m flood_risk.gee_flood_risk --mode monthly
docker restart flood_titiler   # required after overwriting COGs in MinIO
```

---

## Running the System

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

### Regenerate state-level risk scores
```bash
DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/synthetic_flood_risk.py
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

All models last trained on feature rows from 26 gauge stations (see MLflow for latest metrics).

| Model | Notes |
|---|---|
| `xgb_h6` … `xgb_h72` | Primary short- and medium-range models |
| `lstm_h48`, `lstm_h72` | Used in ensemble when quality gates pass |

LSTM for 6h, 12h, 24h often fails the F1 gate while training data remains largely synthetic. XGBoost alone is used for those horizons. As real GloFAS/OpenMeteo data accumulates, shorter-horizon LSTM should improve.

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
| Initial 90-day history | `backfill.py` synthetic generator | Synthetic — used only to bootstrap ML |
| State-level risk polygons | `synthetic_flood_risk.py` | Modelled (not direct observation) |

The 90-day synthetic backfill was necessary because the system has no historical in-situ sensor archive. Going forward, every new hour of real GloFAS/OpenMeteo data replaces synthetic data as the dominant signal.

---

## Known Issues and Limitations

### LSTM short-horizon models not always registered
The 6h, 12h, 24h LSTM models may fail the F1 gate. Expected while the dataset is still largely synthetic.

**Workaround:** XGBoost alone is sufficient for these horizons.

### State risk polygons may still be coarse
`synthetic_flood_risk.py` fallback geometries can be rectangular. Prefer SAR/DEM inundation and susceptibility rasters for map truth.

**Optional fix:** GADM Nigeria Level 1 boundaries for synthetic state polygons.

### Rainfall is distance-weighted (IDW)
`rolling_rain_Xh_mm` uses inverse-distance weighting over the **k=5 nearest met stations within 250 km** (not a national sum). Magnitudes are much smaller than the old all-station sum — `soil_moisture_idx` still uses `/ 80` as a soft saturation proxy.

Implemented in `flink/jobs/idw_rainfall.py`, used by `flood_features.py` and `backfill_features.py`. Refresh existing rows with:
`python backfill_features.py --replace-rain` then retrain.

### HydroBASINS river-basin map layer
`api/data/basins.geojson` (HydroBASINS L7, clipped to Nigeria) is served via `/boundaries/basins`. Gauges store `basin_id`; selecting a station highlights its catchment on the map (LayersPanel toggle **River basins**). Regenerate with `python ingest/boundaries/fetch_hydrobasins.py`; reassign with `python ingest/boundaries/assign_gauge_basins.py`.

### No in-situ sensor data
All gauge and met data is from GloFAS and OpenMeteo — no physical sensors connected. NIHSA / NiMet APIs are not publicly accessible.

### TiTiler stale tiles after COG overwrite
Re-exporting a COG under the same MinIO key can leave TiTiler serving 500s or blank tiles for some XYZ cells.

**Fix:** `docker restart flood_titiler` after each overwrite (or version the filename).

### Vite polling mode has ~300ms latency
`usePolling: true` in vite.config.js is a Docker-on-Windows filesystem limitation, not a code issue.

---

## Adding New Gauge Stations

1. Insert the station into the `gauge_stations` table:
```sql
INSERT INTO gauge_stations (code, name, river, state, lat, lon, bank_full_m, basin_id, geom)
VALUES ('MY_CODE', 'My Station', 'River Name', 'State', 7.5, 5.2, 8.0,
        ST_SetSRID(ST_MakePoint(5.2, 7.5), 4326));
```

2. Optionally add a catchment met station:
```sql
INSERT INTO met_stations (code, name, lat, lon, geom)
VALUES ('MET_MY', 'My Catchment', 7.5, 5.2,
        ST_SetSRID(ST_MakePoint(5.2, 7.5), 4326));
```

3. Real data ingest picks it up automatically on the next run — no code changes needed.

4. Retrain models after enough data has accumulated (suggest 2+ weeks):
```bash
docker-compose run --rm bentoml python train.py
```

---

## Recommended Next Steps (Priority Order)

### 1. Schedule / confirm monthly inundation + susceptibility re-export
**Effort:** Low  
Already wired in APScheduler (`gee_flood_risk`, `inundation_extent`). Confirm wet-season runs and always restart TiTiler after overwrite.

### 2. Constrain IDW rain to mets inside the selected basin (optional)
**Effort:** Low–medium  
Natural follow-up: weight only met stations whose points fall in the gauge’s HydroBASINS polygon (or use true MERIT catchments).

### 3. Accumulate real data and retrain quarterly
**Effort:** Ongoing  
`docker-compose run --rm bentoml python train.py` every ~3 months.

### 4. Optional: full hydrologic HAND / flow-accumulation drainage
**Effort:** Medium  
Current HAND-lite (focal minimum) is good enough for v1. Upgrade drainage mask if valley networks look too coarse.

### 5. NIHSA real gauge integration
**Effort:** Weeks (data agreement)  
Slot into `real_data.py` alongside OpenMeteo.

### 6. Production deployment
**Effort:** 1–2 weeks  
See `CONTEXT.md`. Primary changes: Cloud SQL, GCS, Cloud Run, Firebase Hosting.

---

## GEE Credentials

The Google Earth Engine service account is registered to the `nfie-490816` GCP project.

- Key file: `nfie-490816-516ef004b50f.json` (in project root, git-ignored)
- The key grants access to Earth Engine and GCS within that project
- If the key expires or is rotated, create a new key from the GCP Console under IAM > Service Accounts > `gee-144@nfie-490816.iam.gserviceaccount.com`

---

## Support / Reference

| Resource | Location |
|---|---|
| Full technical reference | `CONTEXT.md` |
| Local quick start | `README.md` |
| API documentation | http://localhost:8000/docs |
| MLflow experiments | http://localhost:5000 |
| MinIO bucket browser | http://localhost:9001 (minioadmin / minioadmin) |
| Grafana dashboards | http://localhost:3001 (admin / admin) |
| OpenMeteo Flood API docs | https://open-meteo.com/en/docs/flood-api |
| GEE Python API docs | https://developers.google.com/earth-engine/guides/python_install |
| GADM Nigeria boundaries | https://gadm.org/download_country.html (select Nigeria, Level 1) |
