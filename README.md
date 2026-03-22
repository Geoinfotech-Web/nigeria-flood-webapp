# Nigeria Flood Prediction Dashboard — Local Dev

## Quick Start

```bash
# 1. Start all services
docker-compose up -d

# 2. Wait ~60 s for TimescaleDB to init, then backfill 90 days of history
docker-compose run --rm ingest python backfill.py

# 3. Start the Flink feature engineering job (standalone mode for local dev)
docker-compose exec flink_jobmanager python /opt/flink/jobs/flood_features.py --standalone &

# 4. Train ML models (needs ~500+ feature rows — takes 2-3 min)
docker-compose run --rm bentoml python train.py

# 5. Open the dashboard
open http://localhost:5173
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
