"""JWT auth for staff admin / super_admin / viewer roles.

Credentials come from ADMIN_USERS_JSON (preferred) or legacy ADMIN_USERNAME /
ADMIN_PASSWORD env vars. Development users require ALLOW_DEV_ADMIN_USERS=1.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/token")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALG = "HS256"
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", str(60 * 8)))

ADMIN_ROLES = frozenset({"admin", "super_admin"})
STAFF_ROLES = frozenset({"admin", "super_admin", "viewer"})


def _load_users() -> dict[str, dict]:
    """Return {username: {hashed, role}}."""
    raw = (os.getenv("ADMIN_USERS_JSON") or "").strip()
    users: dict[str, dict] = {}

    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("ADMIN_USERS_JSON is not valid JSON") from exc
        if not isinstance(payload, list):
            raise RuntimeError("ADMIN_USERS_JSON must be a JSON array")
        for entry in payload:
            if not isinstance(entry, dict):
                continue
            username = str(entry.get("username") or entry.get("email") or "").strip().lower()
            password = entry.get("password")
            password_hash = entry.get("password_hash")
            role = str(entry.get("role") or "admin").strip().lower()
            if not username or role not in STAFF_ROLES:
                continue
            if password_hash:
                hashed = str(password_hash)
            elif password:
                hashed = pwd_ctx.hash(str(password))
            else:
                continue
            users[username] = {"hashed": hashed, "role": role}

    single_user = (os.getenv("ADMIN_USERNAME") or "").strip().lower()
    single_pass = os.getenv("ADMIN_PASSWORD") or ""
    single_role = (os.getenv("ADMIN_ROLE") or "super_admin").strip().lower()
    if single_user and single_pass and single_role in STAFF_ROLES and single_user not in users:
        users[single_user] = {"hashed": pwd_ctx.hash(single_pass), "role": single_role}

    allow_dev = os.getenv("ALLOW_DEV_ADMIN_USERS", "0").strip().lower() in {"1", "true", "yes"}
    if allow_dev:
        users.setdefault("admin", {"hashed": pwd_ctx.hash("admin123"), "role": "admin"})
        users.setdefault("superadmin", {"hashed": pwd_ctx.hash("superadmin123"), "role": "super_admin"})
        users.setdefault("viewer", {"hashed": pwd_ctx.hash("viewer123"), "role": "viewer"})

    return users


_USERS = _load_users()


def _create_token(data: dict) -> str:
    payload = data | {
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str


@router.post("/token", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    username = (form.username or "").strip().lower()
    user = _USERS.get(username)
    if not user or not pwd_ctx.verify(form.password, user["hashed"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    token = _create_token({"sub": username, "role": user["role"]})
    return TokenResponse(access_token=token, role=user["role"], username=username)


async def get_current_user(token: str = Depends(oauth2)) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        username = payload.get("sub")
        role = payload.get("role")
        if not username or role not in STAFF_ROLES:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )
        return {"username": username, "role": role}
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        ) from exc


@router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user


def require_roles(*roles: str):
    allowed = frozenset(roles)

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _dep


require_admin = require_roles("admin", "super_admin")
require_super_admin = require_roles("super_admin")
require_staff = require_roles("admin", "super_admin", "viewer")
