"""Alpaca fetch failures must surface as the alpaca_fetch_error envelope."""

from datetime import date

import pytest
from alpaca.common.exceptions import APIError

from core.backtest.data import _fetch


class _FailingClient:
    def __init__(self, *args, **kwargs):
        pass

    def get_stock_bars(self, req):
        raise APIError('{"message":"invalid symbol: EURUSD=X"}')


def test_api_error_wrapped_as_alpaca_fetch_error(monkeypatch):
    monkeypatch.setattr(
        "alpaca.data.historical.StockHistoricalDataClient", _FailingClient
    )
    with pytest.raises(ValueError, match=r"^alpaca_fetch_error: invalid symbol: EURUSD=X$"):
        _fetch(["EURUSD=X"], date(2020, 1, 1), date(2021, 1, 1), "1D", "k", "s")


def test_connection_error_wrapped_as_alpaca_fetch_error(monkeypatch):
    from requests.exceptions import ConnectionError as RequestsConnectionError

    class _UnreachableClient(_FailingClient):
        def get_stock_bars(self, req):
            raise RequestsConnectionError("dns failure")

    monkeypatch.setattr(
        "alpaca.data.historical.StockHistoricalDataClient", _UnreachableClient
    )
    with pytest.raises(ValueError, match=r"^alpaca_fetch_error: could not reach Alpaca"):
        _fetch(["SPY"], date(2020, 1, 1), date(2021, 1, 1), "1D", "k", "s")
