# Cloud Run — API deploy guide (project ggis-flood-watch)
#
# Prerequisites already done:
# - Cloud SQL + Secret Manager
# - Artifact Registry repo: gfw-api
# - Region: europe-west1
#
# This deploys the FastAPI service. Frontend/domains come later.

## 1. Install / login (on your machine)

```bash
gcloud auth login
gcloud config set project ggis-flood-watch
gcloud config set run/region europe-west1
```

Enable Cloud Run if needed:

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com
```

## 2. Confirm secrets exist in Secret Manager

At minimum:

- `JWT_SECRET`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

Optional later:

- `GOOGLE_MAPS_API_KEY`
- GEE secrets
- `REDIS_URL` (skip for now)

Also note your Cloud SQL connection name, for example:

```text
ggis-flood-watch:europe-west1:gfw-postgres
```

(Replace `gfw-postgres` with your real instance ID.)

## 3. Build and push the API image

From the **repo root** (`Nigeria Flood Dashboard`):

### Option A — Cloud Build (recommended)

```bash
gcloud builds submit ./api --tag europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest
```

### Option B — Local Docker build + push

```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev

docker build -t europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest ./api

docker push europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest
```

## 4. Deploy to Cloud Run

Replace `INSTANCE_CONNECTION_NAME` with your real Cloud SQL connection name.

```bash
gcloud run deploy gfw-api \
  --image europe-west1-docker.pkg.dev/ggis-flood-watch/gfw-api/api:latest \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --timeout 300 \
  --set-env-vars "CORS_ORIGINS=https://gfw.ggis.africa,INSTANCE_CONNECTION_NAME=ggis-flood-watch:europe-west1:YOUR_INSTANCE_ID,BENTOML_URL=,TITILER_URL=" \
  --set-secrets "JWT_SECRET=JWT_SECRET:latest,DB_USER=DB_USER:latest,DB_PASSWORD=DB_PASSWORD:latest,DB_NAME=DB_NAME:latest" \
  --add-cloudsql-instances ggis-flood-watch:europe-west1:YOUR_INSTANCE_ID
```

Notes:

- Leave `REDIS_URL` unset — the API now runs without Redis.
- `CORS_ORIGINS` is set to the public frontend domain.
- `--allow-unauthenticated` is needed for the public map app. Tighten later if required.
- Grant the Cloud Run service account access to Secret Manager and Cloud SQL.

## 5. Grant IAM (if deploy fails on secrets / SQL)

Find the Cloud Run runtime service account (often the default compute SA), then:

```bash
PROJECT_NUMBER=$(gcloud projects describe ggis-flood-watch --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding ggis-flood-watch \
  --member="serviceAccount:${SA}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding ggis-flood-watch \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudsql.client"
```

## 6. Smoke test

After deploy, Cloud Run prints a URL like:

```text
https://gfw-api-xxxxx-ew.a.run.app
```

Test:

```bash
curl https://gfw-api-xxxxx-ew.a.run.app/health
curl https://gfw-api-xxxxx-ew.a.run.app/docs
```

Expected health JSON includes:

```json
{"status":"ok","db":"ok","redis":"disabled"}
```

If `db` is `error`, check:

1. Cloud SQL instance name in `--add-cloudsql-instances`
2. `INSTANCE_CONNECTION_NAME` env var
3. Secret values for DB user/password/name
4. Database `flooddb` exists
5. Schema/init has been applied (or tables exist)

## 7. Map custom domain later

When the web team has Namecheap DNS ready:

1. Map `api.gfw.ggis.africa` to this Cloud Run service
2. Give them the DNS records Cloud Run / Certificate Manager shows
3. Keep using the `*.run.app` URL until DNS propagates

## 8. What changed in the repo for this

- Production `api/Dockerfile` (no `--reload`, uses `$PORT`)
- `CORS_ORIGINS` env (default `https://gfw.ggis.africa`)
- Redis optional when `REDIS_URL` is empty
- Cloud SQL unix socket via `INSTANCE_CONNECTION_NAME`
- Local `docker-compose.yml` still uses `--reload` + `CORS_ORIGINS=*`

## 9. After API is healthy

Next steps:

1. Apply DB schema / seed if Cloud SQL is empty (`infra/timescaledb/init.sql`)
2. Deploy frontend to Firebase Hosting with:
   - `VITE_API_URL=https://api.gfw.ggis.africa` (or the temporary `.run.app` URL)
   - `VITE_WS_URL=wss://api.gfw.ggis.africa` (or `wss://...run.app`)
3. Point Namecheap DNS for `gfw` and `api`
