# Nigeria Flood Dashboard — Developer Handoff

**Date:** March 2026
**Status:** Local development complete. All services operational. Real data pipeline active.

---

## What This System Does

A full-stack flood prediction and monitoring dashboard for Nigeria. It pulls live river discharge data from GloFAS (via OpenMeteo) and meteorological data from OpenMeteo for 26 gauge stations and 29 met stations distributed across all major Nigerian river basins. Machine learning models (XGBoost + LSTM) forecast flood probability at 6, 12, 24, 48, and 72 hour horizons. Satellite flood extent is derived from Sentinel-1 SAR and JRC permanent water data via Google Earth Engine. Everything is displayed on an interactive MapLibre map with real-time WebSocket updates.

---

## System State Summary

| Component | State | Notes |
|---|---|---|
| Docker Compose stack | Running | All 12 containers healthy |
| TimescaleDB | Populated | 90-day backfill + real data ingesting |
| Gauge stations | 26 active | All major Nigerian river basins covered |
| Met stations | 29 active | One catchment point per gauge + strategic cities |
| Feature table | Populated | 57,464 rows as of last training run |
| ML models | 7 registered | xgb_h6/12/24/48/72, lstm_h48, lstm_h72 |
| GEE JRC+SRTM layer | Active | 9.8 MB COG in MinIO, serving via TiTiler |
| Sentinel-1 SAR layer | Active | March 2026 run (dry season — 0 flooded states) |
| Real data ingest | Configured | Runs hourly via APScheduler inside `flood_ingest` |
| Frontend | Live | http://localhost:5173 |

---

## Repository Layout

```
Nigeria Flood Dashboard/
├── docker-compose.yml          — full stack definition (12 services)
├── .env                        — GEE credentials + overrides (git-ignored)
├── nfie-490816-516ef004b50f.json — GEE service account key (git-ignored)
│
├── infra/
│   └── timescaledb/
│       └── init.sql            — schema + seed data (5 original stations)
│
├── ingest/
│   ├── backfill.py             — generates 90-day synthetic history
│   ├── expand_stations.py      — inserts 21 gauge + 25 met stations (one-time)
│   └── flood_risk/
│       ├── real_data.py        — OpenMeteo + GloFAS ingest (DB-driven)
│       ├── gee_flood_risk.py   — GEE JRC+SRTM monthly composite
│       ├── sentinel1_flood.py  — Sentinel-1 SAR flood detection
│       └── synthetic_flood_risk.py — state-level synthetic fallback
│
├── flink/jobs/
│   ├── flood_features.py       — feature engineering (standalone polling)
│   └── backfill_features.py    — one-time backfill of flood_features table
│
├── ml/
│   └── train.py                — XGBoost + LSTM training, BentoML registration
│
├── api/
│   ├── main.py                 — FastAPI app, startup, WebSocket broadcaster
│   └── routers/
│       ├── stations.py         — gauge station REST endpoints
│       ├── flood_risk.py       — flood risk GeoJSON, tiles, tile proxy
│       └── ...
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx             — shell, header, layout
│   │   └── components/
│   │       ├── MapPanel.jsx    — MapLibre map, risk overlay, GEE tiles
│   │       ├── Icons.jsx       — SVG icon library (no emoji)
│   │       ├── StationList.jsx
│   │       ├── PredictionPanel.jsx
│   │       ├── GaugeChart.jsx
│   │       ├── RainfallChart.jsx
│   │       ├── AlertBanner.jsx
│   │       ├── SearchBar.jsx
│   │       ├── BasemapSwitcher.jsx
│   │       ├── RiskLayerControl.jsx
│   │       └── FloodRiskLegend.jsx
│   └── vite.config.js          — usePolling: true (Docker on Windows)
│
├── CONTEXT.md                  — full technical reference (read this first)
└── Handoff.md                  — this file
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

### Run Sentinel-1 SAR flood detection (best in Aug–Oct wet season)
```bash
DB_HOST=localhost \
  GEE_SERVICE_ACCOUNT_EMAIL=gee-144@nfie-490816.iam.gserviceaccount.com \
  GEE_SERVICE_ACCOUNT_KEY=./nfie-490816-516ef004b50f.json \
  .venv/Scripts/python ingest/flood_risk/sentinel1_flood.py
```

### Retrain ML models
```bash
docker-compose run --rm bentoml python train.py
```
Takes ~10 minutes. Registers new model versions in BentoML if quality gates pass.

### Check registered models
```bash
docker-compose exec flood_bentoml python -c "
import bentoml
for tag in ['xgb_h6','xgb_h12','xgb_h24','xgb_h48','xgb_h72','lstm_h48','lstm_h72']:
    try:
        m = bentoml.get(tag + ':latest')
        print(f'{tag}: {m.tag}')
    except:
        print(f'{tag}: not registered')
"
```

### Rebuild frontend after code changes
```bash
docker-compose up -d --build frontend
# Or if Vite HMR is working (it should be with usePolling):
# just save the file — changes reload automatically in browser
```

---

## Current Model Performance

All models trained March 2026 on 57,464 feature rows from 26 gauge stations.

| Model | AUC-ROC | F1 | Notes |
|---|---|---|---|
| `xgb_h6` | 0.9828 | 0.8073 | Excellent short-term accuracy |
| `xgb_h12` | 0.9595 | 0.7481 | Strong |
| `xgb_h24` | 0.9207 | 0.7291 | Strong |
| `xgb_h48` | 0.9184 | 0.8110 | True ensemble with LSTM |
| `lstm_h48` | 0.8013 | 0.6960 | Passes gate; ensemble active |
| `xgb_h72` | 0.9373 | 0.8777 | Strong |
| `lstm_h72` | 0.8398 | 0.7939 | Passes gate; ensemble active |

LSTM for 6h, 12h, 24h did not meet the quality gate. XGBoost alone is used for those horizons. The training data is still predominantly synthetic (GloFAS modelled output, not in-situ sensors). As real data accumulates month-over-month, LSTM performance on shorter horizons should improve.

---

## What Is "Real" vs "Synthetic"

| Data type | Source | Real or synthetic |
|---|---|---|
| River discharge | GloFAS via OpenMeteo Flood API | Real (satellite-constrained hydrological model) |
| Rainfall, temperature, humidity | OpenMeteo Weather API | Real (NWP model, assimilated observations) |
| Flood extent (SAR) | Sentinel-1 via Google Earth Engine | Real satellite imagery |
| Flood susceptibility (JRC+SRTM) | GEE — historical satellite + elevation | Real |
| Initial 90-day history | `backfill.py` synthetic generator | Synthetic — used only to bootstrap ML |
| State-level risk polygons | `synthetic_flood_risk.py` | Modelled (not direct observation) |

The 90-day synthetic backfill was necessary because the system has no historical in-situ sensor archive. It seeds the ML model with plausible seasonal patterns. Going forward, every new hour of real GloFAS/OpenMeteo data replaces synthetic data as the dominant signal.

---

## Known Issues and Limitations

### LSTM short-horizon models not registered
The 6h, 12h, 24h LSTM models failed the F1 gate in the last training run. This is expected with a dataset that is still largely synthetic. Re-run training after 3+ months of real data accumulation.

**Workaround:** XGBoost alone is sufficient for these horizons (AUC > 0.92).

### State risk polygons are bounding boxes
The `flood_risk_areas` geometries are rectangular state bounding boxes, not actual state outlines. The map looks approximate.

**Fix:** Download GADM Nigeria Level 1 boundaries (free, CC-BY) and replace geometries in `flood_risk_areas`. The `synthetic_flood_risk.py` script would need to use these polygons when upserting.

### Rainfall not distance-weighted
`rolling_rain_Xh_mm` sums rainfall from all 29 met stations equally, regardless of distance from the gauge.

**Fix:** In `flink/jobs/flood_features.py`, compute per-station met weights using inverse-distance weighting from gauge coordinates.

### No in-situ sensor data
All gauge and met data is from GloFAS and OpenMeteo model output — there are no physical sensors connected. NIHSA (Nigeria Hydrological Services Agency) and NiMet operate real gauges, but their APIs are not publicly accessible.

**Fix path:** Contact NIHSA for data sharing agreement. Their data ingestion would slot into `real_data.py` alongside the existing OpenMeteo calls.

### SAR shows 0 flooded states in dry season
Sentinel-1 correctly detected no active flooding in March (dry season). The SAR layer currently shows all states as Normal.

**When to re-run:** August–October (peak wet season). Schedule `sentinel1_flood.py` monthly via cron or APScheduler.

### Vite polling mode has ~300ms latency
`usePolling: true` in vite.config.js adds a ~300ms delay between saving a file and seeing the HMR update in the browser. This is a Docker-on-Windows filesystem limitation, not a code issue.

---

## Adding New Gauge Stations

1. Insert the station into the `gauge_stations` table:
```sql
INSERT INTO gauge_stations (code, name, river, state, lat, lon, bank_full_m, geom)
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

### 1. Replace synthetic state polygons with GADM boundaries
**Effort:** 2 hours
Download from gadm.org, load into PostGIS, update `synthetic_flood_risk.py` to use real geometry. High visual impact.

### 2. Schedule Sentinel-1 monthly re-run
**Effort:** 1 hour
Add a cron entry or APScheduler job to run `sentinel1_flood.py` on the 1st of each month. Re-run in October to capture wet season data.

### 3. Add distance-weighted rainfall feature
**Effort:** 3 hours
In `flink/jobs/flood_features.py`, precompute gauge-to-met-station distance matrix at startup, use it to weight contributions to `rolling_rain_Xh_mm`. Will improve ML accuracy for inland stations far from coastal met stations.

### 4. Accumulate real data and retrain quarterly
**Effort:** Ongoing
Every 3 months, run `docker-compose run --rm bentoml python train.py`. As real GloFAS data builds up and synthetic data becomes a smaller fraction, LSTM models will start passing the quality gate for shorter horizons.

### 5. Add NIHSA real gauge integration
**Effort:** Weeks (depends on data agreement)
NIHSA operates physical gauges on Niger and Benue. Even a few real stations would dramatically improve forecast accuracy for the highest-risk corridor. Data would ingest via a new function in `real_data.py` alongside the existing OpenMeteo calls.

### 6. Production deployment
**Effort:** 1–2 weeks
See `CONTEXT.md` production migration path. Primary changes: move TimescaleDB to Cloud SQL, MinIO to GCS, FastAPI + BentoML to Cloud Run, frontend to Firebase Hosting.

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
| API documentation | http://localhost:8000/docs |
| MLflow experiments | http://localhost:5000 |
| MinIO bucket browser | http://localhost:9001 (minioadmin / minioadmin) |
| Grafana dashboards | http://localhost:3001 (admin / admin) |
| OpenMeteo Flood API docs | https://open-meteo.com/en/docs/flood-api |
| GEE Python API docs | https://developers.google.com/earth-engine/guides/python_install |
| GADM Nigeria boundaries | https://gadm.org/download_country.html (select Nigeria, Level 1) |
