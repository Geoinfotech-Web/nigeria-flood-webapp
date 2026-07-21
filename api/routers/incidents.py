import hashlib
import math
import secrets
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, Header, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field, model_validator

router = APIRouter()
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "incidents"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_MEDIA = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}
MAX_MEDIA_BYTES = 25 * 1024 * 1024
VERIFICATIONS_REQUIRED = 2
MAX_VERIFICATION_DISTANCE_KM = 10.0


class IncidentPayload(BaseModel):
    location_name: str = Field(min_length=2, max_length=160)
    affected_street: str | None = Field(default=None, max_length=160)
    flood_source: str | None = Field(default=None, max_length=160)
    incident_type: Literal["Flash flood", "River overflow", "Urban flooding", "Coastal flooding", "Road inundation", "Other"]
    severity: Literal["Low", "Moderate", "High", "Critical"]
    description: str = Field(min_length=10, max_length=1000)
    water_depth_cm: float | None = Field(default=None, ge=0, le=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def coordinates_are_paired(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class VerificationPayload(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def _owned_row(conn, incident_id: int, edit_token: str | None):
    if not edit_token:
        raise HTTPException(status_code=401, detail="Edit token required")
    row = await conn.fetchrow(
        "SELECT * FROM flood_incident_reports WHERE id = $1 AND edit_token_hash = $2",
        incident_id,
        _token_hash(edit_token),
    )
    if not row:
        raise HTTPException(status_code=403, detail="This report cannot be managed from this browser")
    return row


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentPayload,
    request: Request,
    x_reporter_token: str | None = Header(default=None),
):
    edit_token = secrets.token_urlsafe(32)
    query = """
        INSERT INTO flood_incident_reports
            (location_name, affected_street, flood_source, incident_type, severity, description,
             water_depth_cm, latitude, longitude, edit_token_hash, reporter_token_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
    """
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow(
            query, payload.location_name.strip(), _clean(payload.affected_street),
            _clean(payload.flood_source), payload.incident_type, payload.severity,
            payload.description.strip(), payload.water_depth_cm, payload.latitude,
            payload.longitude, _token_hash(edit_token),
            _token_hash(x_reporter_token) if x_reporter_token else None,
        )
    return {**_serialize(row), "edit_token": edit_token}


@router.get("")
async def list_incidents(request: Request, limit: int = Query(default=20, ge=1, le=100)):
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch("""
            SELECT r.*, COUNT(v.id)::INTEGER AS verification_count
            FROM flood_incident_reports r
            LEFT JOIN flood_incident_verifications v ON v.incident_id = r.id
            GROUP BY r.id
            ORDER BY r.created_at DESC
            LIMIT $1
        """, limit)
    return [_serialize(row) for row in rows]


@router.put("/{incident_id}")
async def update_incident(
    incident_id: int,
    payload: IncidentPayload,
    request: Request,
    x_edit_token: str | None = Header(default=None),
):
    async with request.app.state.db.acquire() as conn:
        async with conn.transaction():
            await _owned_row(conn, incident_id, x_edit_token)
            await conn.execute("DELETE FROM flood_incident_verifications WHERE incident_id=$1", incident_id)
            row = await conn.fetchrow("""
                UPDATE flood_incident_reports SET
                    location_name=$2, affected_street=$3, flood_source=$4,
                    incident_type=$5, severity=$6, description=$7,
                    water_depth_cm=$8, latitude=$9, longitude=$10,
                    status='unverified', updated_at=NOW()
                WHERE id=$1 RETURNING *
            """, incident_id, payload.location_name.strip(), _clean(payload.affected_street),
                _clean(payload.flood_source), payload.incident_type, payload.severity,
                payload.description.strip(), payload.water_depth_cm, payload.latitude,
                payload.longitude)
    return _serialize(row)


@router.post("/{incident_id}/verify")
async def verify_incident(
    incident_id: int,
    payload: VerificationPayload,
    request: Request,
    x_verifier_token: str | None = Header(default=None),
    x_edit_token: str | None = Header(default=None),
):
    if not x_verifier_token or len(x_verifier_token) < 20:
        raise HTTPException(status_code=401, detail="Verifier token required")
    verifier_hash = _token_hash(x_verifier_token)
    async with request.app.state.db.acquire() as conn:
        async with conn.transaction():
            report = await conn.fetchrow(
                "SELECT * FROM flood_incident_reports WHERE id=$1 FOR UPDATE", incident_id
            )
            if not report:
                raise HTTPException(status_code=404, detail="Flood report not found")
            if report.get("reporter_token_hash") and secrets.compare_digest(
                report["reporter_token_hash"], verifier_hash
            ):
                raise HTTPException(status_code=403, detail="You cannot verify your own report")
            if x_edit_token and secrets.compare_digest(
                report.get("edit_token_hash") or "", _token_hash(x_edit_token)
            ):
                raise HTTPException(status_code=403, detail="You cannot verify your own report")
            if report["latitude"] is None or report["longitude"] is None:
                raise HTTPException(status_code=409, detail="This report has no mapped location")
            distance_km = _distance_km(
                payload.latitude, payload.longitude, report["latitude"], report["longitude"]
            )
            if distance_km > MAX_VERIFICATION_DISTANCE_KM:
                raise HTTPException(
                    status_code=403,
                    detail=f"You must be within {MAX_VERIFICATION_DISTANCE_KM:g} km of the incident to verify it",
                )
            inserted = await conn.fetchval("""
                INSERT INTO flood_incident_verifications
                    (incident_id, verifier_token_hash, latitude, longitude, distance_km)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (incident_id, verifier_token_hash) DO NOTHING
                RETURNING id
            """, incident_id, verifier_hash, payload.latitude, payload.longitude, distance_km)
            if inserted is None:
                raise HTTPException(status_code=409, detail="You already confirmed this report")
            count = await conn.fetchval(
                "SELECT COUNT(*) FROM flood_incident_verifications WHERE incident_id=$1", incident_id
            )
            report_status = "verified" if count >= VERIFICATIONS_REQUIRED else "unverified"
            await conn.execute(
                "UPDATE flood_incident_reports SET status=$2 WHERE id=$1", incident_id, report_status
            )
    return {
        "incident_id": incident_id,
        "status": report_status,
        "verification_count": count,
        "verifications_required": VERIFICATIONS_REQUIRED,
        "distance_km": round(distance_km, 2),
    }


@router.post("/{incident_id}/media")
async def upload_incident_media(
    incident_id: int,
    request: Request,
    media: UploadFile = File(...),
    x_edit_token: str | None = Header(default=None),
):
    content_type = (media.content_type or "").lower().split(";", 1)[0]
    if content_type not in ALLOWED_MEDIA:
        raise HTTPException(status_code=415, detail="Use JPG, PNG, WebP, MP4, WebM, or MOV")
    data = await media.read(MAX_MEDIA_BYTES + 1)
    if len(data) > MAX_MEDIA_BYTES:
        raise HTTPException(status_code=413, detail="Photo or video must be 25 MB or smaller")
    async with request.app.state.db.acquire() as conn:
        old = await _owned_row(conn, incident_id, x_edit_token)
        filename = f"{incident_id}-{uuid4().hex}{ALLOWED_MEDIA[content_type]}"
        path = UPLOAD_DIR / filename
        path.write_bytes(data)
        media_url = f"/uploads/incidents/{filename}"
        media_type = "image" if content_type.startswith("image/") else "video"
        row = await conn.fetchrow("""
            UPDATE flood_incident_reports
            SET media_url=$2, media_type=$3, updated_at=NOW()
            WHERE id=$1 RETURNING *
        """, incident_id, media_url, media_type)
        _delete_media(old.get("media_url"))
    return _serialize(row)


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: int,
    request: Request,
    x_edit_token: str | None = Header(default=None),
):
    async with request.app.state.db.acquire() as conn:
        row = await _owned_row(conn, incident_id, x_edit_token)
        await conn.execute("DELETE FROM flood_incident_reports WHERE id=$1", incident_id)
    _delete_media(row.get("media_url"))


def _delete_media(media_url: str | None):
    if not media_url:
        return
    path = UPLOAD_DIR / Path(media_url).name
    if path.is_file():
        path.unlink()


def _clean(value: str | None):
    value = value.strip() if value else None
    return value or None


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _serialize(row):
    data = dict(row)
    data.pop("edit_token_hash", None)
    data.pop("reporter_token_hash", None)
    data["created_at"] = data["created_at"].isoformat()
    if data.get("updated_at"):
        data["updated_at"] = data["updated_at"].isoformat()
    return data
