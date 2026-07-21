# Nigeria Flood Prediction Dashboard — Project Context

## Purpose

A real-time flood prediction and risk monitoring dashboard for Nigeria. It ingests live river gauge and meteorological data, runs machine learning models to forecast flood probability at 6–72 hour horizons, and displays flood risk on an interactive map. The system is designed for local development using Docker Compose, with a clear path to production deployment on GCP.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA SOURCES                                                       │
│  OpenMeteo Flood API (GloFAS)    OpenMeteo Weather API              │
│  Google Earth Engine (JRC+SRTM)  Sentinel-1 SAR (GEE)              │
│  Synthetic fallback generator                                       │
└──────────────────────┬──────────────────────┬───────────────────────┘
                       │                      │
              River discharge            Rainfall / met
              (26 gauge stations)        (29 met stations)
                       │                      │
                       ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INGEST  (Python · APScheduler)                                     │
│  real_data.py        — OpenMeteo + GloFAS hourly pull (DB-driven)   │
│  backfill.py         — 90-day synthetic history seed                │
│  expand_stations.py  — one-time station expansion (26g / 29m)       │
│  gee_flood_risk.py   — monthly GEE JRC+SRTM export → MinIO COG     │
│  sentinel1_flood.py  — SAR change-detection → flood extent COG      │
│  synthetic_flood_risk.py — state-level risk fallback                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TIMESCALEDB + PostGIS  (PostgreSQL 16)                             │
│  Hypertables: gauge_readings · met_readings                         │
│               flood_features · flood_predictions                    │
│  Tables:      gauge_stations · met_stations · alert_log             │
│               flood_risk_areas · flood_risk_tiles                   │
│  Aggregates:  gauge_hourly (continuous) · rainfall_daily (continuous│
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FLINK FEATURE JOB  (standalone Python polling, 30s interval)       │
│  Reads gauge_readings + met_readings                                │
│  Writes flood_features  (9 engineered features per station)         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ML TRAINING  (ml/train.py · XGBoost + LSTM)                        │
│  5 horizons: 6h · 12h · 24h · 48h · 72h                            │
│  7 models registered (XGBoost all horizons, LSTM for 48h + 72h)     │
│  Training set: 57,464 rows across 26 stations                       │
│  Registered in: BentoML model store + MLflow experiment tracker     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BENTOML  (port 3000)                                               │
│  Serves XGBoost + LSTM ensemble via HTTP                            │
│  POST /predict  →  flood_prob per horizon                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FASTAPI  (port 8000)                                               │
│  asyncpg connection pool · Redis cache · httpx → BentoML            │
│  REST + WebSocket API (14 endpoints + 2 WS streams)                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  REACT FRONTEND  (port 5173 · Vite + Tailwind)                      │
│  MapLibre GL map · ECharts · WebSocket live feed                    │
│  Flood risk overlay · GEE satellite tiles · SAR flood extent        │
│  SVG icon library · Dark-themed popups · Basemap switcher           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Service Inventory

| Service | Container | Port | Technology | Role |
|---|---|---|---|---|
| Database | `flood_timescaledb` | 5432 | TimescaleDB (PG16) + PostGIS | Time-series + spatial storage |
| Cache | `flood_redis` | 6379 | Redis 7 | API response caching |
| Object store | `flood_minio` | 9000 / 9001 | MinIO | MLflow artifacts, COG rasters |
| Feature jobs | `flood_flink_jobmanager` | 8081 | Apache Flink 1.18 | Feature engineering (standalone mode) |
| ML tracking | `flood_mlflow` | 5000 | MLflow | Experiment tracking + model registry |
| ML serving | `flood_bentoml` | 3000 | BentoML | XGBoost + LSTM inference |
| Data ingest | `flood_ingest` | — | Python + APScheduler | Gauge/met data fetching |
| API | `flood_api` | 8000 | FastAPI | REST + WebSocket backend |
| Frontend | `flood_frontend` | 5173 | React + Vite | Dashboard UI |
| Tile server | `flood_titiler` | 8888 | TiTiler | COG → XYZ map tiles |
| Metrics | `flood_prometheus` | 9090 | Prometheus | API metrics scraping |
| Dashboards | `flood_grafana` | 3001 | Grafana | Ops monitoring |

---

## Database Schema

### Gauge Stations (reference)
```
gauge_stations
  id            SERIAL PK
  code          TEXT UNIQUE      — e.g. "BENUE_LOK"
  name          TEXT             — e.g. "Lokoja Confluence"
  river         TEXT             — e.g. "Benue/Niger"
  state         TEXT             — Nigerian state
  lat, lon      DOUBLE PRECISION
  bank_full_m   DOUBLE PRECISION — bank-full threshold (metres)
  geom          GEOMETRY(Point, 4326)
```

**Current stations (26 total — expanded March 2026):**

| Code | Name | River | State | Bank-full |
|---|---|---|---|---|
| BENUE_LOK | Lokoja Confluence | Benue/Niger | Kogi | 12.5 m |
| NIGER_OHO | Ohoror | Niger | Delta | 10.8 m |
| ANAMBRA_OS | Onitsha Gauge | Niger | Anambra | 9.2 m |
| KADUNA_ZAR | Zaria Gauge | Kaduna | Kaduna | 5.6 m |
| SOKOTO_BIR | Birnin Kebbi | Sokoto | Kebbi | 7.1 m |
| NIGER_JEB | Jebba Dam | Niger | Kwara | 15.0 m |
| NIGER_KAI | Kainji Downstream | Niger | Niger | 16.5 m |
| NIGER_IDA | Idah Crossing | Niger | Kogi | 13.5 m |
| NIGER_ASA | Asaba | Niger | Delta | 11.0 m |
| BENUE_MAK | Makurdi | Benue | Benue | 11.5 m |
| BENUE_IBI | Ibi | Benue | Taraba | 9.0 m |
| BENUE_NUM | Numan | Benue | Adamawa | 8.5 m |
| KADUNA_SHI | Shiroro Dam | Kaduna | Niger | 7.5 m |
| KADUNA_KAD | Kaduna City | Kaduna | Kaduna | 6.5 m |
| CROSS_IKO | Ikom | Cross River | Cross River | 8.5 m |
| CROSS_CAL | Calabar | Cross River | Cross River | 7.0 m |
| ANAM_OTU | Otuocha | Anambra | Anambra | 8.0 m |
| OGUN_ABE | Abeokuta | Ogun | Ogun | 6.0 m |
| HADEJIA_HAD | Hadejia | Hadejia | Jigawa | 4.5 m |
| YOBE_GAS | Gashua | Komadugu Yobe | Yobe | 4.0 m |
| SOKOTO_ARG | Argungu | Rima | Kebbi | 5.5 m |
| GONG_YOL | Yola | Benue/Gongola | Adamawa | 7.5 m |
| OSUN_OSO | Osogbo | Osun | Osun | 5.0 m |
| IMO_OWE | Owerri | Imo | Imo | 4.5 m |
| ZAMFARA_GUS | Gusau | Zamfara | Zamfara | 4.0 m |
| KATALA_TAK | Takum | Katsina Ala | Taraba | 6.5 m |

### Met Stations (reference)
```
met_stations
  id, code, name, lat, lon, geom
```

**Current stations (29 total — expanded March 2026):**

Original 4 NIMET stations: Abuja, Ibadan, Kano Airport, Port Harcourt Int

25 catchment stations added (one per gauge location + strategic cities):
`MET_JEBBA`, `MET_KAINJI`, `MET_IDAH`, `MET_ASABA`, `MET_MAKURDI`, `MET_IBI`, `MET_NUMAN`,
`MET_SHIRORO`, `MET_IKOM`, `MET_CALABAR`, `MET_OTUOCHA`, `MET_ABEOK`, `MET_HADEJIA`,
`MET_GASHUA`, `MET_ARGUNGU`, `MET_YOLA`, `MET_OSOGBO`, `MET_OWERRI`, `MET_GUSAU`, `MET_TAKUM`,
`MET_MAIDUGURI`, `MET_SOKOTO`, `MET_BENIN`, `MET_ENUGU`, `MET_KADUNA`

> All station coordinates are stored in the database. `real_data.py` reads them dynamically — no station lists are hardcoded. Adding a station to `gauge_stations` or `met_stations` is sufficient to include it in the next ingest cycle.

### Time-Series Tables (hypertables)
```
gauge_readings       — every 5 min: water_level_m, flow_rate_m3s
met_readings         — every 15 min: rainfall_mm, temperature_c, humidity_pct,
                       wind_speed_ms, pressure_hpa
flood_features       — every 30 min: 9 engineered features (see ML section)
flood_predictions    — on demand: flood_prob per horizon, xgb_prob, lstm_prob
```

### Spatial Tables
```
flood_risk_areas     — MultiPolygon per state/area with risk_score, risk_tier,
                       source (synthetic|gee_jrc|sentinel1), valid_from, valid_to
flood_risk_tiles     — COG tile URL registry (GEE exports, SAR exports)
```

### Continuous Aggregates
```
gauge_hourly         — 1-hour bucket: avg_level_m, max_level_m, avg_flow_m3s
rainfall_daily       — 1-day bucket: total_rain_mm, max_rain_mm
```

---

## ML Pipeline

### Feature Engineering (9 features)

Computed by `flink/jobs/flood_features.py` every 30 seconds per station:

| Feature | Formula / Source |
|---|---|
| `water_level_m` | Raw gauge reading (metres) |
| `flow_rate_m3s` | Raw gauge reading (m³/s) |
| `level_change_1h` | `level_now − level_1h_ago` |
| `level_change_3h` | `level_now − level_3h_ago` |
| `rolling_rain_3h_mm` | Sum of all met station rainfall in last 3 hours |
| `rolling_rain_24h_mm` | Sum of all met station rainfall in last 24 hours |
| `soil_moisture_idx` | `min(1.0, rain_24h ÷ 80)` — saturation proxy |
| `days_since_last_peak` | Days since water level last exceeded 85% of bank-full |
| `level_pct_bank` | `water_level ÷ bank_full` |

### Flood Label Definition
A **flood event** is defined as: `water_level_m > 0.80 × bank_full_m` at any point within the next N hours (where N = forecast horizon).

### Model Architecture

**XGBoost**
- 300 trees, max depth 6, learning rate 0.05
- `scale_pos_weight` auto-set from class imbalance ratio
- Split: stratified random 80/20 (preserves class distribution)
- Threshold: optimised via ROC curve to maximise F1 (not fixed at 0.5)

**LSTM**
- 2 layers, 64 hidden units, 0.3 dropout
- Input: 12-step sequences (~6 hours of history)
- Split: per-station temporal 80/20 (preserves time ordering)
- Trained with Adam optimiser, BCE loss, 30 epochs

### Ensemble
Final `flood_prob = (xgb_prob + lstm_prob) ÷ 2`. If only one model is registered for a horizon, its probability is used directly.

### Forecast Horizons
6h · 12h · 24h · 48h · 72h — a separate model pair (XGBoost + LSTM) trained per horizon.

### Registered Models (last trained March 2026 — 57,464 rows, 26 stations)

| BentoML tag | Type | Horizon | AUC-ROC | F1 | Threshold | Positive rate |
|---|---|---|---|---|---|---|
| `xgb_h6` | XGBoost | 6h | **0.9828** | 0.8073 | 0.602 | 8.1% |
| `xgb_h12` | XGBoost | 12h | **0.9595** | 0.7481 | 0.598 | 14.4% |
| `xgb_h24` | XGBoost | 24h | **0.9207** | 0.7291 | 0.536 | 25.4% |
| `xgb_h48` | XGBoost | 48h | **0.9184** | 0.8110 | 0.502 | 42.1% |
| `lstm_h48` | LSTM | 48h | 0.8013 | 0.6960 | — | 42.1% |
| `xgb_h72` | XGBoost | 72h | **0.9373** | 0.8777 | 0.516 | 53.0% |
| `lstm_h72` | LSTM | 72h | **0.8398** | 0.7939 | — | 53.0% |

> LSTM models for 6h, 12h, 24h did not meet the quality gate and were not registered. XGBoost-only ensemble used for those horizons.

### Quality Gates
| Metric | Minimum to register |
|---|---|
| AUC-ROC | ≥ 0.80 (configurable via `AUC_GATE`) |
| F1 Score | ≥ 0.60 (configurable via `F1_GATE`) |

### Risk Tiers
| Tier | Flood Probability |
|---|---|
| Normal | < 25% |
| Watch | 25–50% |
| Warning | 50–75% |
| Emergency | > 75% |

---

## Flood Risk Map

### State-Level Risk (Synthetic / Fallback)

Computed by `ingest/flood_risk/synthetic_flood_risk.py` for all 37 states:

```
score = (base_exposure × seasonal_factor × 0.55)
      + (base_exposure × 0.15)
      + (live_gauge_modifier × 0.30)
```

- **`base_exposure`**: fixed flood vulnerability weight per state (0.35–0.90), calibrated against proximity to Niger/Benue/Sokoto/Kaduna/Anambra rivers
- **`seasonal_factor`**: sinusoidal, 0.15 (dry season, Jan–Mar) → 1.0 (peak wet, Aug)
- **`river_proximity_boost`**: ×1.12 multiplier for states bordering a major river
- **`live_gauge_modifier`**: `avg(level_pct_bank × 0.7 + rain_24h/100 × 0.3)` across all 26 gauge stations, reflecting real-time conditions

### GEE JRC+SRTM Composite Layer (Monthly)

Computed by `ingest/flood_risk/gee_flood_risk.py`:

| Component | Weight | Data |
|---|---|---|
| JRC Global Surface Water — historical occurrence | 50% | `JRC/GSW1_4/GlobalSurfaceWater` |
| SRTM elevation inverse — lower = more susceptible | 30% | `USGS/SRTMGL1_003` |
| SRTM slope inverse — flatter = more susceptible | 20% | Derived from SRTM |

Output: Cloud Optimised GeoTIFF at 1 km resolution (~9.8 MB), uploaded to MinIO (`flood-risk-tiles` bucket), served as XYZ map tiles via TiTiler through the API proxy.

### Sentinel-1 SAR Flood Detection (On Demand / Monthly)

Computed by `ingest/flood_risk/sentinel1_flood.py`:

- **Sensor:** Sentinel-1 GRD IW VV-polarisation, descending orbit
- **Method:** Change detection — pixel flagged as flooded when `VV_current < baseline_mean − 1.5 × baseline_std`
- **Baseline:** 2-year Sentinel-1 median composite (dry-season months only)
- **Masks applied:** slope < 5° (SRTM), permanent water < 80% occurrence (JRC)
- **State summaries:** 30 km buffer `reduceRegion` → flood fraction per state → saved to `flood_risk_areas` with `source='sentinel1'`
- **Tiled download:** Nigeria bbox split into 3×2 grid (6 sub-regions) to bypass GEE's ~32 MB getDownloadURL limit; tiles mosaicked with rasterio → single COG → MinIO

Output COG and tile URL registered in `flood_risk_tiles` and served through the same API proxy.

### Tile Proxy
All raster layers are served through the FastAPI tile proxy, never exposing internal Docker hostnames to the browser:
```
GET /flood-risk/tiles/{z}/{x}/{y}.png?url=<encoded-cog-url>
```

---

## API Reference

**Base URL:** `http://localhost:8000`
**Docs:** `http://localhost:8000/docs`

### REST Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/stations` | List all gauge stations (26) |
| GET | `/stations/{id}/readings?hours=24` | Recent gauge readings |
| GET | `/stations/{id}/features` | Latest feature snapshot (9 values) |
| GET | `/stations/{id}/predictions` | Flood predictions for all horizons |
| GET | `/stations/{id}/history` | Hourly aggregated water level history |
| GET | `/alerts?limit=5` | Recent alert log entries |
| GET | `/rainfall/daily` | 7-day daily rainfall per met station |
| GET | `/flood-risk/geojson` | GeoJSON of all state risk areas |
| GET | `/flood-risk/layers` | Available raster tile layers (GEE + SAR) |
| GET | `/flood-risk/tiles/{z}/{x}/{y}.png` | Proxied COG map tiles |
| GET | `/flood-risk/summary` | Count of states per risk tier |
| GET | `/geocode/search?q=Lagos` | Google Places Text Search (preferred) / Nominatim fallback |
| GET | `/map/google-style?map_type=roadmap` | MapLibre style for Google Map Tiles (roadmap/satellite/terrain) |
| GET | `/geocode/reverse?lat=&lon=` | Reverse geocoding (Google preferred) |
| POST | `/auth/token` | JWT login (8-hour token) |

### WebSocket Streams

| Path | Push interval | Payload |
|---|---|---|
| `/ws/gauge-readings` | 30 seconds | All 26 stations: level, flow, pct_bank |
| `/ws/predictions` | On update | Flood probabilities per station per horizon |

---

## Frontend Components

| Component | File | Purpose |
|---|---|---|
| App shell | `App.jsx` | Layout, header, panel routing |
| Map | `MapPanel.jsx` | MapLibre map, risk layers, station markers, GEE/SAR tile overlay |
| Station list | `StationList.jsx` | Left sidebar with bank-level bars |
| Prediction panel | `PredictionPanel.jsx` | Per-horizon forecast cards |
| Water level chart | `GaugeChart.jsx` | 24h ECharts line chart |
| Rainfall chart | `RainfallChart.jsx` | 7-day ECharts bar chart |
| Alert banner | `AlertBanner.jsx` | Active Watch/Warning/Emergency alerts |
| Search bar | `SearchBar.jsx` | Google / Nominatim geocoding with debounce |
| Basemap switcher | `BasemapSwitcher.jsx` | Dark / Light / Streets / Satellite / Topo (SVG icons) |
| Risk layer control | `RiskLayerControl.jsx` | Toggle + opacity + satellite overlay picker |
| Risk legend | `FloodRiskLegend.jsx` | Colour-coded tier key |
| Icon library | `Icons.jsx` | SVG icons replacing all emoji (`IconWaves`, `IconSearch`, `IconGauge`, etc.) |

### Basemaps Available
- **Dark** — CartoDB Dark Matter
- **Light** — CartoDB Positron
- **Streets** — CartoDB Voyager
- **Satellite** — Esri World Imagery + labels
- **Topo** — OpenTopoMap

### Frontend Notes
- Vite configured with `usePolling: true` (required for Docker on Windows — filesystem events do not propagate to Watcher)
- MapLibre popup theme is dark (`#111827` background) via global CSS in `index.css`
- GEE/SAR raster layer auto-selected on mount; swappable via `RiskLayerControl`
- Map layer insertion uses `firstSymbol` detection (not hardcoded layer name) for basemap compatibility

---

## Data Sources

| Data | Provider | API | Frequency | Key Required |
|---|---|---|---|---|
| River discharge (GloFAS) | OpenMeteo | `flood-api.open-meteo.com` | Daily | No |
| Rainfall, temperature, humidity, wind, pressure | OpenMeteo | `api.open-meteo.com` | Hourly | No |
| Flood susceptibility composite | Google Earth Engine | `earthengine.googleapis.com` | Monthly | Service account |
| Sentinel-1 SAR flood extent | Google Earth Engine | `earthengine.googleapis.com` | On demand | Service account |
| Geocoding / place search | Google Places (classic Text/Nearby) + optional Geocoding; Nominatim fallback | `maps.googleapis.com` | On demand | `GOOGLE_MAPS_API_KEY` |
| Google basemap | Map Tiles API session → MapLibre raster style | `tile.googleapis.com` | On demand | `GOOGLE_MAPS_API_KEY` |

### GEE Service Account
- **Email:** `gee-144@nfie-490816.iam.gserviceaccount.com`
- **Project:** `nfie-490816`
- **Key file:** `nfie-490816-516ef004b50f.json` (project root, git-ignored)

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `flood` | TimescaleDB username |
| `POSTGRES_PASSWORD` | `floodpass` | TimescaleDB password |
| `POSTGRES_DB` | `flooddb` | Database name |
| `MINIO_ROOT_USER` | `minioadmin` | MinIO access key |
| `MINIO_ROOT_PASSWORD` | `minioadmin` | MinIO secret key |
| `JWT_SECRET` | `dev-secret-change-in-prod` | API JWT signing key |
| `GEE_SERVICE_ACCOUNT_EMAIL` | — | GEE service account email |
| `GEE_SERVICE_ACCOUNT_KEY` | — | Path to GEE JSON key file |
| `AUC_GATE` | `0.80` | Min AUC-ROC for model registration |
| `F1_GATE` | `0.60` | Min F1 for model registration |

---

## First-Run Setup (Full Pipeline)

```bash
# 1. Start all services
docker-compose up -d

# 2. Backfill 90 days of synthetic history
docker-compose run --rm ingest python backfill.py

# 3. Expand to 26 gauge + 29 met stations (one-time)
DB_HOST=localhost .venv/Scripts/python ingest/expand_stations.py

# 4. Backfill feature table (required for ML training)
DB_HOST=localhost .venv/Scripts/python flink/jobs/backfill_features.py

# 5. Start live feature engineering
DB_HOST=localhost .venv/Scripts/python flink/jobs/flood_features.py --standalone &

# 6. Train ML models (~10 minutes with 26 stations)
docker-compose run --rm bentoml python train.py

# 7. Start real data ingest (OpenMeteo + GloFAS)
DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/real_data.py --once

# 8. Generate flood risk map (state-level)
DB_HOST=localhost .venv/Scripts/python ingest/flood_risk/synthetic_flood_risk.py

# 9. Run GEE JRC+SRTM composite (monthly)
DB_HOST=localhost \
  GEE_SERVICE_ACCOUNT_EMAIL=gee-144@nfie-490816.iam.gserviceaccount.com \
  GEE_SERVICE_ACCOUNT_KEY=./nfie-490816-516ef004b50f.json \
  .venv/Scripts/python ingest/flood_risk/gee_flood_risk.py --mode monthly

# 10. Run Sentinel-1 SAR flood detection (on demand)
DB_HOST=localhost \
  GEE_SERVICE_ACCOUNT_EMAIL=gee-144@nfie-490816.iam.gserviceaccount.com \
  GEE_SERVICE_ACCOUNT_KEY=./nfie-490816-516ef004b50f.json \
  .venv/Scripts/python ingest/flood_risk/sentinel1_flood.py

# 11. Open dashboard
start http://localhost:5173
```

---

## Service URLs

| Service | URL | Credentials |
|---|---|---|
| Dashboard | http://localhost:5173 | — |
| API + Swagger | http://localhost:8000/docs | — |
| MLflow UI | http://localhost:5000 | — |
| Flink UI | http://localhost:8081 | — |
| MinIO console | http://localhost:9001 | minioadmin / minioadmin |
| Grafana | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| TiTiler | http://localhost:8888 | — |

---

## Retraining Models

```bash
# Retrain all horizons (uses all rows in flood_features)
docker-compose run --rm bentoml python train.py

# Retrain a single horizon
docker-compose run --rm bentoml python train.py --horizon 24

# Dry run (evaluate without registering)
docker-compose run --rm bentoml python train.py --dry-run

# Relax quality gates for limited data
docker-compose run --rm bentoml -e AUC_GATE=0.75 -e F1_GATE=0.55 python train.py
```

---

## Production Migration Path (GCP)

| Local component | GCP equivalent |
|---|---|
| TimescaleDB | Cloud SQL (PostgreSQL) + AlloyDB |
| MinIO | Google Cloud Storage |
| Apache Flink | Dataflow (Apache Beam) |
| MLflow | Vertex AI Experiments |
| BentoML | Vertex AI Prediction / Cloud Run |
| FastAPI | Cloud Run |
| React frontend | Firebase Hosting / Cloud CDN |
| APScheduler | Cloud Scheduler + Cloud Functions |

---

## Known Limitations (Current Dev Build)

- **LSTM models (short horizons)**: 6h, 12h, 24h LSTMs did not meet the quality gate on the current synthetic-heavy dataset. XGBoost-only ensemble used for those horizons. Accumulating real GloFAS data over 6+ months should improve LSTM performance significantly.
- **State polygons**: risk area geometries are bounding-box approximations — replace with official GADM Nigeria boundaries (available free from gadm.org) for production.
- **Rainfall catchment weighting**: `rolling_rain_Xh_mm` aggregates all 29 met stations equally. A production system should weight stations by inverse distance to each gauge station.
- **GloFAS discharge → water level**: Manning equation inverse (`h = (Q/k)^(1/1.67)`, k=35) is a rough proxy; station-specific rating curves from NIHSA would improve accuracy significantly.
- **SAR dry season baseline**: Sentinel-1 showed 0 flooded states in March 2026 (dry season). Re-run `sentinel1_flood.py` in August–October to capture wet season flood extent.
- **No physical sensors**: all gauge and met data comes from GloFAS/OpenMeteo model output, not in-situ sensors. Real NIHSA/NiMet sensor integration would dramatically improve accuracy.
