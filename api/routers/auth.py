"""Simple JWT auth — dev-only, no database user store."""
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext

router = APIRouter()
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2  = OAuth2PasswordBearer(tokenUrl="/auth/token")

JWT_SECRET     = os.getenv("JWT_SECRET", "dev-secret")
JWT_ALG        = "HS256"
JWT_EXPIRE_MIN = 60 * 8

# Dev users — replace with DB lookup in production
_USERS = {
    "admin": {"hashed": pwd_ctx.hash("admin123"), "role": "admin"},
    "viewer": {"hashed": pwd_ctx.hash("viewer123"), "role": "viewer"},
}


def _create_token(data: dict) -> str:
    payload = data | {"exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MIN)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


@router.post("/token")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = _USERS.get(form.username)
    if not user or not pwd_ctx.verify(form.password, user["hashed"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid credentials")
    token = _create_token({"sub": form.username, "role": user["role"]})
    return {"access_token": token, "token_type": "bearer"}


async def get_current_user(token: str = Depends(oauth2)) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return {"username": payload["sub"], "role": payload["role"]}
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
