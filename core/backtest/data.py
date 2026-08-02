import asyncio
import json
from datetime import date

import pandas as pd


def _timeframe_to_alpaca(timeframe: str):
    from alpaca.data.timeframe import TimeFrame

    mapping = {"1D": TimeFrame.Day, "1W": TimeFrame.Week, "1M": TimeFrame.Month}
    tf = mapping.get(timeframe)
    if tf is None:
        raise ValueError(f"unsupported timeframe: {timeframe!r}")
    return tf


def _api_error_detail(exc: Exception) -> str:
    """Alpaca's APIError stringifies to a raw JSON body — pull out the message."""
    try:
        return json.loads(str(exc)).get("message") or str(exc)
    except (json.JSONDecodeError, TypeError):
        return str(exc)


def _fetch(
    assets: list[str],
    start: date,
    end: date,
    timeframe: str,
    api_key: str,
    secret_key: str,
) -> dict[str, pd.DataFrame]:
    from alpaca.common.exceptions import APIError
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockBarsRequest
    from requests.exceptions import RequestException

    client = StockHistoricalDataClient(api_key, secret_key)
    req = StockBarsRequest(
        symbol_or_symbols=assets,
        timeframe=_timeframe_to_alpaca(timeframe),
        start=str(start),
        end=str(end),
    )
    try:
        df = client.get_stock_bars(req).df
    except APIError as exc:
        # Keep the error-envelope contract: SDK failures (invalid symbol, bad
        # keys, rate limit) surface as 422 alpaca_fetch_error, never a raw 500.
        raise ValueError(f"alpaca_fetch_error: {_api_error_detail(exc)}") from exc
    except RequestException as exc:
        raise ValueError(f"alpaca_fetch_error: could not reach Alpaca ({exc.__class__.__name__})") from exc

    result: dict[str, pd.DataFrame] = {}
    for symbol in assets:
        if isinstance(df.index, pd.MultiIndex):
            if symbol not in df.index.get_level_values(0):
                raise ValueError(f"alpaca_fetch_error: {symbol} — no data returned for date range")
            sym_df = df.loc[symbol].copy()
        else:
            sym_df = df.copy()

        if sym_df.empty:
            raise ValueError(f"alpaca_fetch_error: {symbol} — empty response for date range")

        # Ensure a plain DatetimeIndex (alpaca-py already provides one, but guard anyway)
        if not isinstance(sym_df.index, pd.DatetimeIndex):
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
