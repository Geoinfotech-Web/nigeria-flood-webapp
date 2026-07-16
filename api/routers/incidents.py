import hashlib
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
async def create_incident(payload: IncidentPayload, request: Request):
    edit_token = secrets.token_urlsafe(32)
    query = """
        INSERT INTO flood_incident_reports
            (location_name, affected_street, flood_source, incident_type, severity, description,
             water_depth_cm, latitude, longitude, edit_token_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    """
    async with request.app.state.db.acquire() as conn:
        row = await conn.fetchrow(
            query, payload.location_name.strip(), _clean(payload.affected_street),
            _clean(payload.flood_source), payload.incident_type, payload.severity,
            payload.description.strip(), payload.water_depth_cm, payload.latitude,
            payload.longitude, _token_hash(edit_token),
        )
    return {**_serialize(row), "edit_token": edit_token}


@router.get("")
async def list_incidents(request: Request, limit: int = Query(default=20, ge=1, le=100)):
    async with request.app.state.db.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM flood_incident_reports ORDER BY created_at DESC LIMIT $1", limit
        )
    return [_serialize(row) for row in rows]


@router.put("/{incident_id}")
async def update_incident(
    incident_id: int,
    payload: IncidentPayload,
    request: Request,
    x_edit_token: str | None = Header(default=None),
):
    async with request.app.state.db.acquire() as conn:
        await _owned_row(conn, incident_id, x_edit_token)
        row = await conn.fetchrow("""
            UPDATE flood_incident_reports SET
                location_name=$2, affected_street=$3, flood_source=$4,
                incident_type=$5, severity=$6, description=$7,
                water_depth_cm=$8, latitude=$9, longitude=$10, updated_at=NOW()
            WHERE id=$1 RETURNING *
        """, incident_id, payload.location_name.strip(), _clean(payload.affected_street),
            _clean(payload.flood_source), payload.incident_type, payload.severity,
            payload.description.strip(), payload.water_depth_cm, payload.latitude,
            payload.longitude)
    return _serialize(row)


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


def _serialize(row):
    data = dict(row)
    data.pop("edit_token_hash", None)
    data["created_at"] = data["created_at"].isoformat()
    if data.get("updated_at"):
        data["updated_at"] = data["updated_at"].isoformat()
    return data
