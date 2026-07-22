# GGIS Flood Watch AWS Hosting Runbook

This is the step-by-step deployment guide for the web/DevOps team to host GGIS Flood Watch on AWS.

## Target Endpoints

- Frontend: `https://gfw.ggis.africa`
- API: `https://api.gfw.ggis.africa`
- API docs: `https://api.gfw.ggis.africa/docs`
- WebSockets:
  - `wss://api.gfw.ggis.africa/ws/gauge-readings`
  - `wss://api.gfw.ggis.africa/ws/predictions`

## 1. What Is Being Deployed

GGIS Flood Watch is a multi-service application, not just a static frontend.

Required production services:

1. React frontend
2. FastAPI backend
3. PostgreSQL database
4. Redis
5. TiTiler
6. Object storage for flood raster tiles and incident uploads
7. Ingest / scheduled refresh jobs
8. ML prediction service if production predictions are enabled

Optional internal services:

- MLflow
- Grafana
- Prometheus
- Flink UI

## 2. Recommended AWS Architecture

| App component | AWS service |
|---|---|
| React frontend | S3 + CloudFront |
| FastAPI API | ECS Fargate behind an ALB |
| PostgreSQL + PostGIS/Timescale | Amazon RDS for PostgreSQL |
| Redis cache | Amazon ElastiCache for Redis |
| Flood raster tiles and uploads | Amazon S3 |
| TiTiler | ECS Fargate |
| Ingest jobs | ECS scheduled tasks via EventBridge Scheduler |
| ML service | ECS Fargate |
| Secrets | AWS Secrets Manager or SSM Parameter Store |
| DNS | Route 53 |
| TLS certificates | AWS Certificate Manager |
| Logs and metrics | CloudWatch |

## 3. Prerequisites Before Touching AWS

Confirm all of the following first:

### Product / owner inputs

1. Public domain is confirmed as `gfw.ggis.africa`
2. API subdomain is confirmed as `api.gfw.ggis.africa`
3. AWS account for production is selected
4. Deployment owner and DNS owner are known

### Access needed

1. AWS IAM access for:
   - Route 53
   - ACM
   - ECS
   - ECR
   - RDS
   - ElastiCache
   - S3
   - CloudFront
   - EventBridge Scheduler
   - Secrets Manager / Parameter Store
   - CloudWatch
2. GitHub access to the repository
3. Access to the current `.env` values or secure secret source

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

Google Cloud must have these enabled:

1. Places API (legacy Text Search / Nearby Search)
2. Geocoding API
3. Map Tiles API
4. Earth Engine API

## 4. Current Repo State the Team Must Know

This repository is deployment-ready in architecture, but not fully production-hardened in packaging.

Important repo realities:

- [`frontend/Dockerfile`](frontend/Dockerfile) is development-only and runs `npm run dev`
- [`api/Dockerfile`](api/Dockerfile) is development-only and runs `uvicorn ... --reload`
- [`docker-compose.yml`](docker-compose.yml) is a local-development stack using local ports and MinIO
- [`api/main.py`](api/main.py) currently allows all CORS origins
- object storage assumptions are MinIO-style and must be adapted to S3 where needed

The web team should treat this runbook as the deployment source of truth, not `docker-compose.yml`.

## 5. Deployment Order

Create infrastructure in this order:

1. ACM certificates
2. Route 53 hosted-zone confirmation
3. S3 buckets
4. ECR repositories
5. RDS PostgreSQL
6. ElastiCache Redis
7. ECS cluster
8. CloudWatch log groups
9. Secrets Manager / Parameter Store entries
10. ALB and target groups
11. ECS services and task definitions
12. CloudFront distribution
13. Route 53 DNS records
14. EventBridge schedules
15. First-run initialization tasks

## 6. Create TLS Certificates

In ACM:

1. Request a certificate for `gfw.ggis.africa`
2. Request a certificate for `api.gfw.ggis.africa`
3. Use DNS validation
4. Add the validation records in Route 53
5. Wait for both certificates to become `Issued`

Notes:

- CloudFront certificate must be in `us-east-1`
- ALB certificate must be in the same region as the ALB

## 7. Prepare DNS

In Route 53:

1. Confirm control of the `ggis.africa` hosted zone
2. Create records later after CloudFront and ALB exist:
   - `gfw.ggis.africa` → CloudFront
   - `api.gfw.ggis.africa` → ALB

## 8. Create S3 Buckets

Create at least these buckets:

1. frontend bucket:
   - stores `frontend/dist` assets
2. flood raster bucket:
   - stores COGs and raster layer assets
3. incident uploads bucket:
   - stores user-submitted report media

Recommended settings:

- block public access on data buckets
- enable versioning on raster and uploads buckets
- add lifecycle rules later if storage grows

## 9. Create ECR Repositories

Create repositories for:

1. `gfw-api`
2. `gfw-ingest`
3. `gfw-ml`
4. `gfw-titiler`

If the team wants a containerized frontend for some reason, create it separately, but the preferred frontend path is S3 + CloudFront.

## 10. Create the Database

Provision RDS PostgreSQL with:

1. private subnets only
2. automated backups enabled
3. security group that only allows application access
4. parameter group or extension support for:
   - PostGIS
   - TimescaleDB, if required by the chosen DB strategy

Use values based on [`.env.example`](.env.example):

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`

Before go-live, verify:

1. PostGIS is enabled
2. Timescale support is available if required
3. initial schema / seed path is understood from [`infra/timescaledb/init.sql`](infra/timescaledb/init.sql)

## 11. Create Redis

Provision ElastiCache Redis:

1. private subnets only
2. security group open only to ECS services that need it
3. capture the endpoint for `REDIS_URL`

Example production value:

```bash
REDIS_URL=redis://<redis-endpoint>:6379/0
```

## 12. Create the ECS Cluster

Create an ECS Fargate cluster for:

1. API service
2. TiTiler service
3. ML service
4. scheduled ingest jobs

Recommended separation:

- one service per task definition
- separate task role and execution role

## 13. Create CloudWatch Log Groups

Create log groups for:

1. API
2. ingest
3. ML service
4. TiTiler
5. ECS scheduled tasks

Set a retention policy instead of keeping logs forever by default.

## 14. Store Secrets and Configuration

Store secrets in Secrets Manager or Parameter Store.

### API secrets / config

```bash
DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=<db-name>
REDIS_URL=redis://<redis-endpoint>:6379/0
BENTOML_URL=http://<internal-ml-service>:3000
TITILER_URL=http://<internal-titiler-service>
JWT_SECRET=<strong-random-secret>
GOOGLE_MAPS_API_KEY=<server-side-google-key>
```

### Frontend build variables

```bash
VITE_API_URL=https://api.gfw.ggis.africa
VITE_WS_URL=wss://api.gfw.ggis.africa
```

### Ingest task variables

```bash
DB_HOST=<rds-endpoint>
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

### ML task variables

Use the equivalent DB values plus any model-service settings the container requires.

### TiTiler variables

The local stack uses MinIO-oriented variables in [`docker-compose.yml`](docker-compose.yml). For AWS production, adapt them to S3-backed access and remove local MinIO endpoint assumptions.

The local values look like:

```bash
AWS_ACCESS_KEY_ID=<local-minio-user>
AWS_SECRET_ACCESS_KEY=<local-minio-password>
AWS_ENDPOINT_URL=http://minio:9000
AWS_S3_ENDPOINT=http://minio:9000
AWS_VIRTUAL_HOSTING=FALSE
```

For production:

1. use IAM role access where possible
2. remove local MinIO endpoint values
3. point TiTiler to real S3 bucket objects

## 15. Build and Package the Frontend

The frontend should not use the existing dev Dockerfile for production.

Use this packaging flow:

1. in `frontend/`, install dependencies
2. set build variables:
   - `VITE_API_URL=https://api.gfw.ggis.africa`
   - `VITE_WS_URL=wss://api.gfw.ggis.africa`
3. run `npm run build`
4. upload `frontend/dist/` to the frontend S3 bucket
5. serve that bucket through CloudFront

Commands:

```bash
cd frontend
npm install
VITE_API_URL=https://api.gfw.ggis.africa VITE_WS_URL=wss://api.gfw.ggis.africa npm run build
```

On Windows CI or alternative shells, set the environment variables using the platform’s syntax.

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
2. pin a production runtime command
3. optionally add a non-root user
4. optionally precompile or optimize dependencies

Suggested runtime command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Build, tag, and push the API image to ECR.

## 17. Build and Package the Ingest Jobs

The ingest service in [`docker-compose.yml`](docker-compose.yml) currently assumes:

- local DB hostname
- mounted GEE credential file
- MinIO endpoint

For AWS:

1. build an ingest container image and push it to ECR
2. pass DB settings via secrets
3. provide the GEE JSON file securely
4. replace MinIO-specific assumptions with S3-compatible access
5. run the scheduler or scheduled jobs using ECS task definitions

## 18. Build and Package the ML Service

If predictions are part of the first release:

1. containerize and push the ML service image
2. deploy it as an internal ECS service
3. capture the internal service URL for `BENTOML_URL`

If predictions are not part of first launch, explicitly document that limitation before go-live.

## 19. Build and Package TiTiler

Current local deployment uses the published TiTiler image in [`docker-compose.yml`](docker-compose.yml).

For AWS:

1. run TiTiler as an ECS service
2. place it in private networking
3. give it access to the raster S3 bucket
4. expose it only internally to the API

## 20. Create the ALB and Target Groups

Create an Application Load Balancer for the API.

Configure:

1. HTTPS listener with ACM certificate
2. target group for the API service
3. health check path:
   - `/health`
4. WebSocket support for:
   - `/ws/gauge-readings`
   - `/ws/predictions`

The ALB should back `api.gfw.ggis.africa`.

## 21. Deploy ECS Services

Deploy services in this order:

1. API
2. TiTiler
3. ML service

Recommended checks after each:

1. task starts successfully
2. health check passes
3. logs show no secret/config errors
4. internal network resolution works

## 22. Create the CloudFront Distribution

Set up CloudFront for the frontend:

1. origin = frontend S3 bucket
2. alternate domain name = `gfw.ggis.africa`
3. ACM certificate in `us-east-1`
4. redirect HTTP to HTTPS
5. configure SPA fallback if needed so client-side routes resolve correctly

## 23. Create Route 53 Records

After ALB and CloudFront are live:

1. create alias `A` record:
   - `gfw.ggis.africa` → CloudFront
2. create alias `A` record:
   - `api.gfw.ggis.africa` → ALB

## 24. Initialize the Database

The local stack uses `infra/timescaledb/init.sql` to initialize schema and seed stations.

Before app traffic:

1. apply initial schema
2. confirm required tables exist
3. confirm seed station data is loaded
4. confirm API can connect to the DB

Also note from [`api/main.py`](api/main.py):

- the API creates/extends `flood_incident_reports` on startup
- uploads are served from `/app/uploads` locally and must map cleanly to S3/object storage in production

## 25. Run First-Time Data Tasks

Run initial tasks in this order:

1. initial backfill
2. initial real data ingest / refresh
3. initial ML training or model registration if required
4. initial GEE flood layer jobs
5. OSM exposure refresh

Based on existing docs, expect to run equivalents of:

- `backfill.py`
- flood risk refresh scripts
- model training scripts

Use ECS one-off tasks or scheduled task definitions rather than manual long-term server scripts.

## 26. Configure Scheduled Jobs

Create EventBridge schedules for:

### Frequent jobs

- gauge ingest
- met/weather ingest
- prediction refresh

### Periodic jobs

- flood susceptibility refresh
- inundation history refresh
- SAR flood extent refresh
- urban flash flood refresh
- OSM exposure refresh

Document the exact schedule values and owners in the deployment handoff.

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

Before public launch, change this to allow only the real frontend origin:

- `https://gfw.ggis.africa`

### Remove dev runtime settings

1. remove `--reload` from API startup
2. do not run the Vite dev server in production

### Keep internal services private

These must not be internet-exposed:

- RDS
- Redis
- TiTiler
- ML service
- scheduled-job infrastructure

### Secrets must stay out of git

Use AWS secret stores only. Never commit:

- `.env`
- Google API keys
- GEE JSON files
- production DB credentials

### Enable backups and logging

1. RDS backups enabled
2. S3 versioning where needed
3. CloudWatch logs retained with a policy
4. deployment alarms configured if available

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

Do not mark production live until all of the following are true:

- frontend is reachable on `gfw.ggis.africa`
- API is reachable on `api.gfw.ggis.africa`
- TLS is valid on both domains
- CORS is restricted correctly
- API health checks are green
- ALB target health is green
- CloudFront is serving current build assets
- DB backups are enabled
- Redis is private
- raster tiles render on the public map
- scheduled jobs are enabled
- logs are visible in CloudWatch
- deployment rollback path is documented

## 30. First Launch Notes for the Web Team

Important functional caveats from the existing project docs:

1. some inputs are modeled rather than direct field sensors
2. flood layer quality depends on GEE jobs having run successfully
3. the repository is local-dev oriented and needs production task definitions and hardened images
4. production should eventually improve state boundaries and some hydrologic logic

## 31. Files to Use Alongside This Runbook

Share these together:

1. [`AWS_HOSTING_RUNBOOK.md`](AWS_HOSTING_RUNBOOK.md)
2. [`DEPLOYMENT_AWS_GFW.md`](DEPLOYMENT_AWS_GFW.md)
3. [`DEPLOYMENT_AWS_GFW.pdf`](DEPLOYMENT_AWS_GFW.pdf)
4. [`Handoff.md`](Handoff.md)
5. [`README.md`](README.md)
6. [`CONTEXT.md`](CONTEXT.md)

## 32. Short Execution Summary

Provision AWS infrastructure first, store secrets securely, build the frontend with production API and WebSocket URLs, deploy API/TiTiler/ML/ingest services through ECS, connect the custom domains through ALB and CloudFront, initialize data and flood layers, then complete smoke tests before announcing the site live.
