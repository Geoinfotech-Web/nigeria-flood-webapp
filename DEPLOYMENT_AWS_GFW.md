# GGIS Flood Watch Deployment Guide

This document is for the web team deploying **GGIS Flood Watch** to the public domain:

- Public app: `https://gfw.ggis.africa`
- API: `https://api.gfw.ggis.africa`
- WebSockets: `wss://api.gfw.ggis.africa`

## Goal

Deploy the current application to AWS so the public can use the live map, place search, gauge forecasts, flood layers, and community reporting features.

This application is a **full-stack system**, not a static website only.

## Recommended AWS Architecture

Use the following production setup:

| Component | AWS service |
|---|---|
| React frontend (`frontend/dist`) | S3 + CloudFront |
| FastAPI backend | ECS Fargate behind an Application Load Balancer |
| PostgreSQL + PostGIS/Timescale | Amazon RDS for PostgreSQL |
| Redis cache | Amazon ElastiCache for Redis |
| Raster tiles + uploads | Amazon S3 |
| TiTiler service | ECS Fargate |
| Scheduled ingest / refresh jobs | EventBridge Scheduler + ECS scheduled tasks |
| Secrets | AWS Secrets Manager or SSM Parameter Store |
| DNS | Route 53 |
| TLS certificates | AWS Certificate Manager |
| Monitoring / logs | CloudWatch |

## Public URL Plan

| Purpose | URL |
|---|---|
| Frontend | `https://gfw.ggis.africa` |
| API | `https://api.gfw.ggis.africa` |
| API docs | `https://api.gfw.ggis.africa/docs` |
| WebSockets | `wss://api.gfw.ggis.africa/ws/gauge-readings` and `wss://api.gfw.ggis.africa/ws/predictions` |

## Core Services That Must Run

The following services are required for a working public deployment:

1. Frontend static site
2. FastAPI backend
3. PostgreSQL database
4. Redis cache
5. TiTiler
6. Object storage for flood raster tiles and uploaded incident media
7. Ingest / scheduled background jobs
8. ML prediction service if production predictions depend on it

Optional for launch:

- MLflow
- Flink UI
- Grafana
- Prometheus

These are useful for internal operations, but they do not need public exposure.

## Domain and DNS

Create these DNS records:

| Record | Type | Target |
|---|---|---|
| `gfw.ggis.africa` | `A` / alias | CloudFront distribution |
| `api.gfw.ggis.africa` | `A` / alias | Application Load Balancer |

TLS certificates should be issued in AWS Certificate Manager for:

- `gfw.ggis.africa`
- `api.gfw.ggis.africa`

## Frontend Build Requirements

The frontend must be built with production environment variables.

Required build-time variables:

```bash
VITE_API_URL=https://api.gfw.ggis.africa
VITE_WS_URL=wss://api.gfw.ggis.africa
```

Build command:

```bash
cd frontend
npm install
npm run build
```

Deploy the generated `frontend/dist/` files to S3 and serve them through CloudFront.

Important:

- Do not deploy the Vite dev server to production.
- The current repo `frontend/Dockerfile` is for development (`npm run dev`) and should not be used as-is for production hosting.

## Backend Deployment Requirements

Deploy the FastAPI API as a container on ECS Fargate behind an Application Load Balancer.

Important production changes:

1. Do not run `uvicorn` with `--reload`
2. Restrict CORS to the real frontend domain
3. Use HTTPS only
4. Ensure ALB supports WebSocket upgrade for `/ws/*`

Suggested runtime command:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Required Environment Variables

These values must be set in the production environment.

### API

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

### Frontend build

```bash
VITE_API_URL=https://api.gfw.ggis.africa
VITE_WS_URL=wss://api.gfw.ggis.africa
```

### Ingest / flood layer jobs

```bash
DB_HOST=<rds-endpoint>
DB_PORT=5432
DB_USER=<db-user>
DB_PASSWORD=<db-password>
DB_NAME=<db-name>
GEE_SERVICE_ACCOUNT_EMAIL=<gee-service-account-email>
GEE_SERVICE_ACCOUNT_KEY=/run/secrets/gee-service-account.json
GOOGLE_MAPS_API_KEY=<server-side-google-key>
```

### Storage

If replacing MinIO with S3, configure the storage layer accordingly and ensure both TiTiler and ingest jobs can read/write flood layer assets and incident uploads.

## Secrets That Must Be Provided

The deployment team will need:

1. `JWT_SECRET`
2. Database username and password
3. `GOOGLE_MAPS_API_KEY`
4. GEE service account email
5. GEE service account JSON key
6. S3 bucket names / access policies

Store secrets in Secrets Manager or Parameter Store. Do not commit them to git.

## Google Services Needed

The following Google APIs should be enabled:

1. Places API (legacy Text Search / Nearby Search)
2. Geocoding API
3. Map Tiles API
4. Earth Engine API

Notes:

- The Google Maps key is used server-side by the API.
- The frontend should never expose the raw Google Maps API key.
- The app already proxies Google tile usage through the backend.

## Data and Storage Plan

Production storage should separate at least two S3 locations:

| Bucket / prefix | Purpose |
|---|---|
| flood raster bucket | COG files and related map layer assets |
| incident uploads bucket | Photos/videos submitted by users |

Retention and backup:

- Enable versioning where practical
- Enable lifecycle rules for older raster artifacts if storage grows
- Back up critical buckets and database snapshots regularly

## Database Notes

Use Amazon RDS for PostgreSQL and ensure:

1. Automated backups are enabled
2. Database is private, not internet-facing
3. Security groups allow access only from application tasks
4. PostGIS is available
5. TimescaleDB support is confirmed for the chosen PostgreSQL setup

If TimescaleDB is not immediately available, the team should validate whether plain PostgreSQL + PostGIS is sufficient for initial launch or whether Timescale-enabled hosting is required before go-live.

## Networking and Security

Minimum security posture:

1. Only CloudFront and ALB are public
2. RDS, Redis, TiTiler, and internal ML services remain private
3. ECS services run in private subnets where appropriate
4. Only HTTPS is exposed
5. WebSocket support is enabled through ALB
6. Security groups are locked down to least privilege

Also required:

1. Tighten CORS from `*` to `https://gfw.ggis.africa`
2. Use a strong `JWT_SECRET`
3. Restrict Google API keys to approved server usage
4. Rotate secrets periodically

## Scheduled Jobs

These jobs should be scheduled after deployment.

### Frequent jobs

- Gauge / weather ingest
- Prediction refresh
- Any existing background refresh the app relies on

### Periodic jobs

- Flood susceptibility refresh
- Inundation history refresh
- SAR flood extent refresh
- Urban flash flood layer refresh
- OSM exposure refresh

Use EventBridge Scheduler to trigger ECS tasks or AWS Batch jobs.

## First-Time Deployment Runbook

1. Provision AWS infrastructure:
   - S3
   - CloudFront
   - ALB
   - ECS services
   - RDS
   - Redis
   - Route 53
   - ACM certificates
2. Create and store all production secrets
3. Build frontend with production `VITE_API_URL` and `VITE_WS_URL`
4. Deploy frontend static files to S3 + CloudFront
5. Build and deploy backend container
6. Build and deploy TiTiler
7. Deploy ML service if production predictions depend on it
8. Run database initialization / migration
9. Run initial backfill / ingest jobs
10. Run initial GEE flood-layer generation jobs
11. Verify the public app, API, and WebSockets
12. Enable scheduled jobs

## Acceptance Checklist

Before public launch, verify all of the following:

- `https://gfw.ggis.africa` loads successfully
- Place search works
- Gauge forecasts load
- WebSocket live updates connect successfully
- Google basemap options work
- Flood raster layers display
- Community flood reports can be submitted
- Uploaded media persists after restart / redeploy
- API docs load at `https://api.gfw.ggis.africa/docs`
- CORS is restricted correctly
- TLS is valid for both domains
- Database backups are enabled
- Application logs are visible in CloudWatch

## Known Production Caveats

The web team should be aware of these current application realities:

1. Some model inputs are from modeled sources rather than physical field sensors
2. Flood susceptibility and inundation layers depend on GEE jobs having run successfully
3. The repository currently contains development-oriented Dockerfiles for frontend and API; production container definitions should be hardened
4. Current code allows broad CORS and should be narrowed for production
5. Production should use official state boundaries and improved weighting logic where possible in future iterations

## Recommended Immediate Follow-Up for the Web Team

1. Create production Dockerfiles / task definitions for:
   - API
   - TiTiler
   - ML service
   - Scheduled ingest jobs
2. Decide whether to use:
   - RDS PostgreSQL with Timescale support, or
   - another PostgreSQL option that guarantees required extensions
3. Replace MinIO assumptions with S3-backed configuration
4. Prepare a staging deployment before public launch

## Owner Inputs Needed Before Deployment

The deployment team will need the following from the product owner:

1. Confirmation that the public domain is `gfw.ggis.africa`
2. Approval for the API subdomain `api.gfw.ggis.africa`
3. Google Maps API key
4. GEE service account credentials
5. AWS account / IAM access path
6. Preferred alerting and backup contacts

## Short Handoff Summary

GGIS Flood Watch should be deployed on AWS as a multi-service web application, with the frontend on CloudFront/S3, the API on ECS behind an ALB, the database on RDS, Redis on ElastiCache, tiles/uploads on S3, and scheduled ingest jobs via EventBridge-triggered ECS tasks. The production public URL should be `https://gfw.ggis.africa`, with the API at `https://api.gfw.ggis.africa`. The deployment must use production environment variables, server-side Google and GEE credentials, private internal services, TLS, restricted CORS, and working WebSocket support.
