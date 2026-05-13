import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def bars_fixture():
    rng = np.random.default_rng(42)
    idx = pd.date_range("2020-01-01", periods=300, freq="D")
    close = pd.Series(100.0 + np.cumsum(rng.standard_normal(300) * 0.5), index=idx)
    df = pd.DataFrame({
        "open": close * 0.999,
        "high": close * 1.002,
        "low": close * 0.998,
        "close": close,
        "volume": np.full(300, 1_000_000, dtype=float),
    })
    return {"SPY": df}
