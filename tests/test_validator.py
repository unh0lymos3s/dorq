import pytest

from core.backtest.validator import validate_strategy_code

_CLEAN = """
def strategy(bars):
    entries = {}
    exits = {}
    for symbol, df in bars.items():
        ema20 = df.ta.ema(length=20)
        ema50 = df.ta.ema(length=50)
        rsi = df.ta.rsi(length=14)
        cross_up = (ema20 > ema50) & (ema20.shift(1) <= ema50.shift(1))
        entries[symbol] = cross_up & (rsi < 70)
        cross_dn = (ema20 < ema50) & (ema20.shift(1) >= ema50.shift(1))
        exits[symbol] = cross_dn | (rsi > 80)
    return pd.DataFrame(entries).fillna(False), pd.DataFrame(exits).fillna(False)
"""

_NUMPY = """
def strategy(bars):
    entries = {}
    exits = {}
    for symbol, df in bars.items():
        ma = np.convolve(df['close'].values, np.ones(20) / 20, mode='same')
        entries[symbol] = pd.Series(df['close'].values > ma, index=df.index)
        exits[symbol] = pd.Series(df['close'].values < ma, index=df.index)
    return pd.DataFrame(entries), pd.DataFrame(exits)
"""


def test_allows_clean_ema_strategy():
    validate_strategy_code(_CLEAN)


def test_allows_numpy_usage():
    validate_strategy_code(_NUMPY)


def test_blocks_import():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("import os\ndef strategy(bars): return {}, {}")


def test_blocks_import_from():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("from os import system\ndef strategy(bars): return {}, {}")


def test_blocks_eval():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    eval('1+1')")


def test_blocks_exec():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    exec('pass')")


def test_blocks_open():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    open('/etc/passwd')")


def test_blocks_dunder_import_call():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    __import__('os')")


def test_blocks_dunder_attribute():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    x = bars.__class__")


def test_blocks_getattr():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    getattr(bars, 'x')")


def test_blocks_compile():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    compile('pass', '<>', 'exec')")


def test_blocks_globals():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    globals()")


def test_missing_strategy_function():
    with pytest.raises(ValueError, match="strategy"):
        validate_strategy_code("def not_strategy(bars): return {}, {}")


def test_syntax_error():
    with pytest.raises(ValueError, match="syntax"):
        validate_strategy_code("def strategy(bars): return (")


def test_blocks_indirect_reference():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    e = eval\n    return e('1'), e('2')")


def test_blocks_eval_in_default_arg():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars, _=open('/etc/passwd')): return bars, bars")


def test_blocks_eval_as_decorator():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("@open\ndef strategy(bars): return bars, bars")


def test_blocks_ns_attribute_assignment():
    with pytest.raises(ValueError, match="forbidden"):
        validate_strategy_code("def strategy(bars):\n    pd.options.mode.chained_assignment = None")


def test_blocks_async_strategy():
    with pytest.raises(ValueError, match="async"):
        validate_strategy_code("async def strategy(bars): return bars, bars")
