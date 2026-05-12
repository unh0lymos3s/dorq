from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/papers", tags=["papers"])


@router.post("/upload")
async def upload_paper():
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "not implemented")


@router.post("/url")
async def paper_from_url():
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "not implemented")
