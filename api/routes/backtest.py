from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.post("/run")
async def run_backtest():
    return JSONResponse(status_code=501, content={"detail": "not implemented"})


@router.get("/{backtest_id}")
async def get_backtest(backtest_id: str):
    return JSONResponse(status_code=501, content={"detail": "not implemented"})
