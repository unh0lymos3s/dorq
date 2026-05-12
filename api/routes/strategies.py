from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/strategies", tags=["strategies"])


@router.post("/generate")
async def generate_strategy():
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "not implemented")
