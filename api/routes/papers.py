from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/papers", tags=["papers"])


@router.post("/upload")
async def upload_paper():
    return JSONResponse(status_code=501, content={"detail": "not implemented"})


@router.post("/url")
async def paper_from_url():
    return JSONResponse(status_code=501, content={"detail": "not implemented"})
