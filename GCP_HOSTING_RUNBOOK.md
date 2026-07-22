# GGIS Flood Watch GCP Hosting Runbook

This is the step-by-step deployment guide for hosting GGIS Flood Watch on Google Cloud Platform.

## Target Endpoints

- Frontend: `https://gfw.ggis.africa`
- API: `https://api.gfw.ggis.africa`
- API docs: `https://api.gfw.ggis.africa/docs`
- WebSockets:
  - `wss://api.gfw.ggis.africa/ws/gauge-readings`
  - `wss://api.gfw.ggis.africa/ws/predictions`

## 1. What Is Being Deployed

GGIS Flood Watch is a multi-service application, not just a static site.

Required production services:

1. React frontend
2. FastAPI backend
3. PostgreSQL database
4. Redis cache
5. TiTiler
6. Object storage for flood raster layers and incident uploads
7. Ingest / scheduled refresh jobs
8. ML prediction service if production predictions are enabled

Optional internal services:

- MLflow
- Grafana
- Prometheus
- Flink UI

## 2. Recommended GCP Architecture

| App component | GCP service |
|---|---|
| React frontend | Firebase Hosting or Cloud Storage + Cloud CDN |
| FastAPI API | Cloud Run |
| PostgreSQL + PostGIS/Timescale | Cloud SQL for PostgreSQL |
| Redis cache | Memorystore for Redis |
| Flood raster tiles and uploads | Google Cloud Storage |
| TiTiler | Cloud Run |
| Ingest jobs | Cloud Run jobs + Cloud Scheduler |
| ML service | Cloud Run or Vertex AI endpoint |
| Secrets | Secret Manager |
| DNS | Cloud DNS or external DNS provider |
| TLS certificates | Managed certificates via load balancer / Firebase Hosting |
| Logs and metrics | Cloud Logging + Cloud Monitoring |

## 3. Prerequisites Before Touching GCP

Confirm all of the following first:

### Product / owner inputs

1. Public domain is confirmed as `gfw.ggis.africa`
2. API subdomain is confirmed as `api.gfw.ggis.africa`
3. Target GCP project is selected
4. Deployment owner and DNS owner are known

### Access needed

1. GCP IAM access for:
   - Cloud Run
   - Cloud Build or Artifact Registry
   - Cloud SQL
   - Memorystore
   - Cloud Storage
   - Cloud Scheduler
   - Secret Manager
   - Load Balancing / managed certificates
   - Cloud DNS if applicable
   - Cloud Logging / Monitoring
2. GitHub access to the repository
3. Access to current secret values or secure secret source

### Secrets needed

From [`.env.example`](.env.example), gather:

- `JWT_SECRET`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `GOOGLE_MAPS_API_KEY`
- `GEE_SERVICE_ACCOUNT_EMAIL`
- GEE JSON key file

### External platform requirements

Google Cloud must have these APIs enabled:

1. Places API (legacy Text Search / Nearby Search)
2. Geocoding API
3. Map Tiles API
4. Earth Engine API

Also enable the required GCP project APIs:

1. Cloud Run API
2. Cloud Build API
3. Artifact Registry API
4. Cloud SQL Admin API
5. Secret Manager API
6. Cloud Scheduler API
7. Memorystore for Redis API
8. Compute Engine API
9. Certificate Manager or load balancing related APIs as needed

## 4. Current Repo State the Team Must Know

This repository is close to production architecture, but its packaging is still development-oriented.

Important repo realities:

- [`frontend/Dockerfile`](frontend/Dockerfile) is development-only and runs `npm run dev`
- [`api/Dockerfile`](api/Dockerfile) is development-only and runs `uvicorn ... --reload`
- [`docker-compose.yml`](docker-compose.yml) is a local-development stack
- [`api/main.py`](api/main.py) currently allows all CORS origins
- object storage assumptions are MinIO-style and must be adapted to Cloud Storage

The team should use this runbook instead of `docker-compose.yml` as the production guide.

## 5. High-Level GCP Mapping

The repo already documents the intended production migration path in [`CONTEXT.md`](CONTEXT.md):

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

For the first production launch, the simplest practical version is:

1. Frontend on Firebase Hosting
2. API on Cloud Run
3. TiTiler on Cloud Run
4. ML service on Cloud Run
5. Cloud SQL PostgreSQL
6. Memorystore Redis
7. Cloud Storage for uploads and raster layers
8. Cloud Scheduler calling Cloud Run jobs

## 6. Deployment Order

Create infrastructure in this order:

1. Confirm project, billing, and region
2. Enable required APIs
3. Create Artifact Registry repositories
4. Create Cloud Storage buckets
5. Create Cloud SQL PostgreSQL
6. Create Memorystore Redis
7. Create Secret Manager secrets
8. Create service accounts and IAM bindings
9. Build and publish container images
10. Deploy Cloud Run services
11. Configure custom domains and certificates
12. Configure DNS records
13. Create Cloud Scheduler jobs
14. Run first-time initialization tasks

## 7. Choose Region and Naming

Pick one primary region for compute and database, for example:

- `africa-south1` if latency and service support match requirements
- or another region with the required managed services

Use consistent names such as:

- `gfw-api`
- `gfw-titiler`
- `gfw-ml`
- `gfw-ingest`
- `gfw-frontend`

## 8. Enable GCP APIs

Enable at least:

1. Cloud Run API
2. Cloud Build API
3. Artifact Registry API
4. Secret Manager API
5. Cloud SQL Admin API
6. Memorystore for Redis API
7. Cloud Scheduler API
8. IAM API
9. Compute Engine API
10. Cloud Storage API
11. Certificate / load-balancing APIs as needed by the chosen frontend/domain setup

## 9. Create Artifact Registry Repositories

Create repositories for:

1. `gfw-api`
2. `gfw-ingest`
3. `gfw-ml`
4. `gfw-titiler`

These will hold the production images for Cloud Run services and jobs.

## 10. Create Cloud Storage Buckets

Create at least these buckets:

1. frontend assets bucket if not using Firebase Hosting directly from build output
2. flood raster bucket
3. incident uploads bucket

Recommended settings:

- enable uniform bucket-level access
- enable versioning on raster and uploads buckets where practical
- apply lifecycle rules later if storage usage grows

## 11. Create Cloud SQL PostgreSQL

Provision Cloud SQL PostgreSQL with:

1. private networking where possible
2. automated backups enabled
3. point-in-time recovery if budget allows
4. required DB name and user values from [`.env.example`](.env.example)

Use:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`

Before go-live, verify:

1. PostGIS support is enabled if needed
2. the initial schema path from [`infra/timescaledb/init.sql`](infra/timescaledb/init.sql) is understood
3. the team has decided whether TimescaleDB-specific support is required immediately or later

If Cloud SQL cannot provide the exact Timescale behavior needed, the team should validate whether plain PostgreSQL + PostGIS is sufficient for first launch.

## 12. Create Memorystore Redis

Provision Memorystore for Redis:

1. in the same region as Cloud Run where possible
2. reachable privately from Cloud Run / VPC connector path
3. capture the connection value for `REDIS_URL`

Example production value:

```bash
REDIS_URL=redis://<redis-endpoint>:6379/0
```

## 13. Create Secret Manager Secrets

Store production values in Secret Manager.

### API secrets / config

```bash
DB_HOST=<cloud-sql-host>
DB_PORT=5432
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=<db-name>
REDIS_URL=redis://<redis-endpoint>:6379/0
BENTOML_URL=https://<ml-service-url>
TITILER_URL=https://<titiler-service-url>
JWT_SECRET=<strong-random-secret>
GOOGLE_MAPS_API_KEY=<server-side-google-key>
```

### Frontend build variables

```bash
VITE_API_URL=https://api.gfw.ggis.africa
VITE_WS_URL=wss://api.gfw.ggis.africa
```

### Ingest job variables

```bash
DB_HOST=<cloud-sql-host>
DB_PORT=5432
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=<db-name>
GEE_SERVICE_ACCOUNT_EMAIL=<gee-service-account-email>
GEE_SERVICE_ACCOUNT_KEY=/run/secrets/gee-service-account.json
GOOGLE_MAPS_API_KEY=<server-side-google-key>
GAUGE_INTERVAL_SECONDS=300
MET_INTERVAL_SECONDS=900
```

### ML service variables

Use the equivalent DB values plus model-serving settings needed by the service.

### TiTiler variables

The local stack in [`docker-compose.yml`](docker-compose.yml) uses MinIO-flavored settings:

```bash
AWS_ACCESS_KEY_ID=<local-minio-user>
AWS_SECRET_ACCESS_KEY=<local-minio-password>
AWS_ENDPOINT_URL=http://minio:9000
AWS_S3_ENDPOINT=http://minio:9000
AWS_VIRTUAL_HOSTING=FALSE
```

For GCP production:

1. replace local MinIO assumptions with Cloud Storage access
2. grant bucket access through service accounts
3. point raster access to the production bucket strategy

## 14. Create Service Accounts and IAM

Create separate service accounts for:

1. API
2. TiTiler
3. ML service
4. ingest jobs

Grant least-privilege access:

- API: Secret Manager access, Cloud SQL connection, storage access if needed
- TiTiler: read access to raster bucket
- ML: DB access if required
- ingest: DB access, storage access, Earth Engine credential access, secret access

## 15. Build and Package the Frontend

The frontend should not use the existing development Dockerfile for production.

Use this build flow:

1. in `frontend/`, install dependencies
2. set:
   - `VITE_API_URL=https://api.gfw.ggis.africa`
   - `VITE_WS_URL=wss://api.gfw.ggis.africa`
3. run `npm run build`
4. deploy the output to Firebase Hosting or Cloud Storage + CDN

Commands:

```bash
cd frontend
npm install
VITE_API_URL=https://api.gfw.ggis.africa VITE_WS_URL=wss://api.gfw.ggis.africa npm run build
```

If the team prefers Firebase Hosting, connect the site to the production domain afterward.

## 16. Build and Package the API

Current state from [`api/Dockerfile`](api/Dockerfile):

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

Required production changes:

1. remove `--reload`
2. pin a production startup command
3. optionally add a non-root user
4. optionally optimize image size

Suggested runtime command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Build the image, push it to Artifact Registry, and deploy it to Cloud Run.

## 17. Build and Package the Ingest Jobs

The ingest service currently assumes:

- local DB host
- mounted GEE credential file
- MinIO endpoint

For GCP:

1. build an ingest container image
2. push it to Artifact Registry
3. pass DB settings via Secret Manager
4. provide the GEE JSON securely to the runtime
5. replace MinIO assumptions with Cloud Storage access
6. run refresh tasks as Cloud Run jobs triggered by Cloud Scheduler

## 18. Build and Package the ML Service

If production predictions are part of first launch:

1. build and publish the ML image
2. deploy it to Cloud Run
3. capture its internal or private URL for `BENTOML_URL`

If predictions are deferred, document that before launch.

## 19. Build and Package TiTiler

The local stack uses the published TiTiler image in [`docker-compose.yml`](docker-compose.yml).

For GCP:

1. deploy TiTiler to Cloud Run
2. grant it read access to the raster bucket
3. keep it non-public if API proxying is preferred
4. point the API to the TiTiler URL through `TITILER_URL`

## 20. Deploy Cloud Run Services

Deploy services in this order:

1. API
2. TiTiler
3. ML service

Recommended checks after each:

1. service starts successfully
2. secrets resolve correctly
3. DB connectivity works
4. logs show no startup failures

## 21. Configure the Frontend Hosting

### Option A: Firebase Hosting

1. create a Firebase site linked to the project
2. deploy the built frontend
3. attach the custom domain `gfw.ggis.africa`
4. wait for managed SSL to become active

### Option B: Cloud Storage + Cloud CDN

1. upload built assets to Cloud Storage
2. expose through a load balancer / backend bucket
3. enable Cloud CDN
4. attach `gfw.ggis.africa`
5. wait for managed SSL to become active

For simplicity, Firebase Hosting is the easier first path.

## 22. Configure the API Domain

Expose the API service as:

- `https://api.gfw.ggis.africa`

If using Cloud Run domain mapping or an HTTPS load balancer:

1. map the custom domain
2. provision managed certificate
3. create the required DNS records
4. confirm HTTPS works

The API must also support WebSockets at the same host:

- `/ws/gauge-readings`
- `/ws/predictions`

## 23. Create DNS Records

Create DNS records for:

1. `gfw.ggis.africa`
2. `api.gfw.ggis.africa`

If DNS is managed outside GCP, give the resulting target records to whoever controls `ggis.africa`.

## 24. Initialize the Database

The local stack uses `infra/timescaledb/init.sql` to initialize schema and seed stations.

Before live traffic:

1. apply initial schema
2. confirm required tables exist
3. confirm seed station data is loaded
4. confirm the API connects successfully

Also note from [`api/main.py`](api/main.py):

- the API creates or extends `flood_incident_reports` on startup
- uploads are currently served from `/app/uploads` locally and must be adapted to Cloud Storage-backed persistence in production

## 25. Run First-Time Data Tasks

Run initial tasks in this order:

1. initial backfill
2. initial real data ingest / refresh
3. initial ML training or model registration if required
4. initial GEE flood layer jobs
5. OSM exposure refresh

Based on existing docs in [`Handoff.md`](Handoff.md), expect to run equivalents of:

- `backfill.py`
- `real_data.py`
- `gee_flood_risk.py`
- `inundation_extent.py`
- `urban_footprints.py`
- `urban_flash_flood.py`
- model training scripts

Use Cloud Run jobs or controlled one-off runs instead of long-lived manual scripts.

## 26. Configure Cloud Scheduler Jobs

Create Cloud Scheduler jobs for:

### Frequent jobs

- gauge ingest
- met/weather ingest
- prediction refresh if implemented separately

### Periodic jobs

- flood susceptibility refresh
- inundation history refresh
- SAR flood extent refresh
- urban flash flood refresh
- OSM exposure refresh

Each scheduled job should invoke a Cloud Run job or a controlled internal endpoint, not an ad hoc VM script.

## 27. Production Hardening Required Before Launch

### CORS must be restricted

Current code in [`api/main.py`](api/main.py):

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Before public launch, restrict CORS to:

- `https://gfw.ggis.africa`

### Remove dev runtime settings

1. remove `--reload` from API startup
2. do not run the Vite dev server in production

### Keep internal services private where possible

These should not be broadly exposed:

- Cloud SQL
- Redis
- TiTiler if API proxying remains the pattern
- ML service if internal-only is sufficient

### Secrets must stay out of git

Use Secret Manager. Never commit:

- `.env`
- Google API keys
- GEE JSON files
- production DB credentials

### Enable backups and logging

1. Cloud SQL backups enabled
2. Cloud Storage versioning where needed
3. Cloud Logging retained and monitored
4. alerting configured if available

## 28. Smoke Test Checklist

After deployment, verify:

1. `https://gfw.ggis.africa` loads
2. `https://api.gfw.ggis.africa/health` returns OK
3. `https://api.gfw.ggis.africa/docs` loads
4. place search works
5. Google basemap options work
6. WebSocket gauge feed connects
7. WebSocket prediction feed connects
8. flood raster layers display
9. expert mode loads
10. public mode loads
11. community flood report submission works
12. uploaded media persists after redeploy

## 29. Go-Live Acceptance Checklist

Do not mark the site live until all of the following are true:

- frontend is reachable on `gfw.ggis.africa`
- API is reachable on `api.gfw.ggis.africa`
- TLS is valid on both domains
- CORS is restricted correctly
- API health checks are green
- frontend is serving the current build
- DB backups are enabled
- Redis connectivity is stable
- raster tiles render on the map
- scheduled jobs are active
- logs are visible in Cloud Logging
- rollback path is documented

## 30. First Launch Notes for the Web Team

Important functional caveats from the current project docs:

1. some inputs are modeled rather than direct field sensors
2. flood layer quality depends on GEE jobs having run successfully
3. the repository is local-dev oriented and needs production hardening
4. production should eventually improve state boundaries and some hydrologic logic

## 31. Files to Use Alongside This Runbook

Share these together:

1. [`GCP_HOSTING_RUNBOOK.md`](GCP_HOSTING_RUNBOOK.md)
2. [`AWS_HOSTING_RUNBOOK.md`](AWS_HOSTING_RUNBOOK.md) for cross-reference only if needed
3. [`DEPLOYMENT_AWS_GFW.md`](DEPLOYMENT_AWS_GFW.md) for architecture overlap
4. [`DEPLOYMENT_AWS_GFW.pdf`](DEPLOYMENT_AWS_GFW.pdf)
5. [`Handoff.md`](Handoff.md)
6. [`README.md`](README.md)
7. [`CONTEXT.md`](CONTEXT.md)

## 32. Short Execution Summary

Enable the required GCP services, create Artifact Registry, Cloud Storage, Cloud SQL, Memorystore, Secret Manager entries, and Cloud Run services, then attach `gfw.ggis.africa` and `api.gfw.ggis.africa`, initialize the data pipeline and flood layers, and complete smoke tests before announcing the site live.
