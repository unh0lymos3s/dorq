from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/backtest", tags=["backtest"])


@router.post("/run")
async def run_backtest():
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "not implemented")


@router.get("/{backtest_id}")
async def get_backtest(backtest_id: str):
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "not implemented")
