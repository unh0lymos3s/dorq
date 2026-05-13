import pandas as pd
import pytest

from core.backtest.executor import exec_strategy

_EMA_CROSSOVER = """
def strategy(bars):
    entries = {}
    exits = {}
    for symbol, df in bars.items():
        ema20 = df.ta.ema(length=20)
        ema50 = df.ta.ema(length=50)
        entries[symbol] = (ema20 > ema50) & (ema20.shift(1) <= ema50.shift(1))
        exits[symbol]   = ema20 < ema50
    return pd.DataFrame(entries).fillna(False), pd.DataFrame(exits).fillna(False)
"""


def test_exec_strategy_returns_dataframes(bars_fixture):
    entries, exits = exec_strategy(_EMA_CROSSOVER, bars_fixture)
    assert isinstance(entries, pd.DataFrame)
    assert isinstance(exits, pd.DataFrame)
    assert set(entries.columns) == set(bars_fixture.keys())
    assert set(exits.columns) == set(bars_fixture.keys())


def test_exec_strategy_returns_bool_dtype(bars_fixture):
    entries, exits = exec_strategy(_EMA_CROSSOVER, bars_fixture)
    assert entries.dtypes.iloc[0] == bool
    assert exits.dtypes.iloc[0] == bool


def test_exec_rejects_import(bars_fixture):
    code = "import os\ndef strategy(bars): return pd.DataFrame(), pd.DataFrame()"
    with pytest.raises(ValueError):
        exec_strategy(code, bars_fixture)


def test_exec_rejects_non_dataframe_return(bars_fixture):
    code = "def strategy(bars): return 1, 2"
    with pytest.raises(ValueError, match="pd.DataFrame"):
        exec_strategy(code, bars_fixture)


def test_exec_rejects_wrong_arity(bars_fixture):
    code = "def strategy(bars): return pd.DataFrame()"
    with pytest.raises(ValueError, match="2-tuple"):
        exec_strategy(code, bars_fixture)


def test_exec_wraps_runtime_error(bars_fixture):
    code = "def strategy(bars): raise RuntimeError('oops')"
    with pytest.raises(ValueError, match="strategy_exec_error"):
        exec_strategy(code, bars_fixture)


def test_exec_or_logic(bars_fixture):
    code = """
def strategy(bars):
    entries = {}
    exits = {}
    for symbol, df in bars.items():
        rsi = df.ta.rsi(length=14)
        entries[symbol] = rsi < 30
        exits[symbol] = (rsi > 70) | (df['close'] < df['close'].shift(5))
    return pd.DataFrame(entries).fillna(False), pd.DataFrame(exits).fillna(False)
"""
    entries, exits = exec_strategy(code, bars_fixture)
    assert isinstance(entries, pd.DataFrame)
    assert isinstance(exits, pd.DataFrame)
