"""C's API router. Endpoints are added here as the contract requires them."""
from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict:
    return {"ok": True}
