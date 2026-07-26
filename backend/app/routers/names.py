# routers/names.py -- Name Generator API
# ========================================
# Two small read-only endpoints backing the character Name Generator panel:
#
#   GET /api/names/cultures  -- the picker's dropdown data (cultures grouped
#                               by region + the era list, so the frontend
#                               never hardcodes buckets)
#   GET /api/names/pool      -- one culture's name pool for a kind/era/gender,
#                               with honest era fallback (used_era reports
#                               what was actually served)
#
# The data lives in the app-level names.db seeded at startup from JSON
# shipped with the app -- see utils/names_store.py. Endpoints are plain
# `def` (not async): FastAPI runs them in a threadpool, which suits the
# short synchronous sqlite reads.

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.utils.names_store import (
    ERAS,
    ERA_ORDER,
    VALID_KINDS,
    culture_exists,
    get_pool,
    list_cultures,
)

router = APIRouter(prefix="/api/names", tags=["names"])


class CultureInfo(BaseModel):
    id: str
    label: str
    region: str


class EraInfo(BaseModel):
    id: str
    label: str


class CulturesResponse(BaseModel):
    cultures: list[CultureInfo]
    eras: list[EraInfo]


class PoolResponse(BaseModel):
    names: list[str]
    # The era actually served. Differs from the request when the culture
    # doesn't carry that bucket (e.g. American South has no medieval names)
    # -- the UI shows "closest available" using this.
    used_era: str


@router.get("/cultures", response_model=CulturesResponse)
def get_cultures():
    """Everything the picker needs to render its dropdowns."""
    return CulturesResponse(
        cultures=[CultureInfo(**c) for c in list_cultures()],
        eras=[EraInfo(id=e_id, label=label) for e_id, label in ERAS],
    )


@router.get("/pool", response_model=PoolResponse)
def get_name_pool(culture: str, kind: str, era: str = "any", gender: str = "any"):
    """One name pool. The frontend deals/rerolls from it client-side."""
    if kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown kind: {kind}. Use given or surname.")
    if era != "any" and era not in ERA_ORDER:
        raise HTTPException(status_code=400, detail=f"Unknown era: {era}.")
    if gender not in ("male", "female", "any"):
        raise HTTPException(status_code=400, detail=f"Unknown gender: {gender}.")
    if not culture_exists(culture):
        raise HTTPException(status_code=400, detail=f"Unknown culture: {culture}.")

    names, used_era = get_pool(culture, kind, era, gender)
    return PoolResponse(names=names, used_era=used_era)
