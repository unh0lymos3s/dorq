from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/strategies", tags=["strategies"])


@router.post("/generate")
async def generate_strategy():
    return JSONResponse(status_code=501, content={"detail": "not implemented"})
