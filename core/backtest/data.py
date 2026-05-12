import asyncio
from datetime import date

import pandas as pd


def _timeframe_to_alpaca(timeframe: str):
    from alpaca.data.timeframe import TimeFrame

    mapping = {"1D": TimeFrame.Day, "1W": TimeFrame.Week, "1M": TimeFrame.Month}
    tf = mapping.get(timeframe)
    if tf is None:
        raise ValueError(f"unsupported timeframe: {timeframe!r}")
    return tf


def _fetch(
    assets: list[str],
    start: date,
    end: date,
    timeframe: str,
    api_key: str,
    secret_key: str,
) -> dict[str, pd.DataFrame]:
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockBarsRequest

    client = StockHistoricalDataClient(api_key, secret_key)
    req = StockBarsRequest(
        symbol_or_symbols=assets,
        timeframe=_timeframe_to_alpaca(timeframe),
        start=str(start),
        end=str(end),
    )
    bars = client.get_stock_bars(req)
    df = bars.df

    result: dict[str, pd.DataFrame] = {}
    for symbol in assets:
        try:
            sym_df = df.loc[symbol].copy() if isinstance(df.index, pd.MultiIndex) else df
        except KeyError:
            raise ValueError(f"alpaca_fetch_error: {symbol} — no data returned for date range")
        if sym_df.empty:
            raise ValueError(f"alpaca_fetch_error: {symbol} — no data returned for date range")
        sym_df.index = pd.to_datetime(sym_df.index)
        result[symbol] = sym_df

    return result


async def fetch_bars(
    assets: list[str],
    start: date,
    end: date,
    timeframe: str,
    api_key: str,
    secret_key: str,
) -> dict[str, pd.DataFrame]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch, assets, start, end, timeframe, api_key, secret_key)
