"""GGIS Flood Watch Developer API v1 routers."""
from fastapi import APIRouter

from routers.v1 import catalog, subscribe

router = APIRouter()
router.include_router(subscribe.router)
router.include_router(catalog.router)
