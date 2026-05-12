import asyncio
import re

import pandas as pd
import pandas_ta  # noqa: F401 — registers df.ta accessor

from core.models.strategy import StrategySpec

_CONDITION_RE = re.compile(
    r"^(?P<left>\w+)\s*(?P<op>>=|<=|>|<|==)\s*(?P<right>[\w.]+)$"
)
_ALLOWED_OPS = {">=", "<=", ">", "<", "=="}


def _compute_indicators(df: pd.DataFrame, spec: StrategySpec) -> dict[str, pd.Series]:
    signals: dict[str, pd.Series] = {"close": df["close"]}

    for ind in spec.indicators:
        name = ind.name.upper()
        p = ind.params

        if name == "SMA":
            period = int(p["period"])
            signals[f"SMA_{period}"] = df.ta.sma(length=period)
        elif name == "RSI":
            period = int(p["period"])
            signals[f"RSI_{period}"] = df.ta.rsi(length=period)
        elif name == "MACD":
            fast, slow, signal = int(p["fast"]), int(p["slow"]), int(p["signal"])
            macd = df.ta.macd(fast=fast, slow=slow, signal=signal)
            signals[f"MACD_{fast}_{slow}_{signal}"] = macd[f"MACD_{fast}_{slow}_{signal}"]
            signals[f"MACDs_{fast}_{slow}_{signal}"] = macd[f"MACDs_{fast}_{slow}_{signal}"]
        elif name == "BB":
            period = int(p["period"])
            bb = df.ta.bbands(length=period)
            signals[f"BBU_{period}"] = bb[f"BBU_{period}_2.0"]
            signals[f"BBM_{period}"] = bb[f"BBM_{period}_2.0"]
            signals[f"BBL_{period}"] = bb[f"BBL_{period}_2.0"]
        elif name == "ATR":
            period = int(p["period"])
            signals[f"ATR_{period}"] = df.ta.atr(length=period)
        else:
            raise ValueError(f"unsupported indicator: {name!r}")

    return signals


def _eval_condition(condition: str, signals: dict[str, pd.Series], close: pd.Series) -> pd.Series:
    m = _CONDITION_RE.match(condition.strip())
    if not m:
        raise ValueError(f"unparseable condition: {condition!r}")

    op = m.group("op")
    if op not in _ALLOWED_OPS:
        raise ValueError(f"disallowed operator in condition: {op!r}")

    left_key = m.group("left")
    right_key = m.group("right")

    left = signals.get(left_key, close if left_key == "close" else None)
    if left is None:
        raise ValueError(f"unknown signal {left_key!r} in condition {condition!r}")

    try:
        right: pd.Series | float = float(right_key)
    except ValueError:
        right = signals.get(right_key)
        if right is None:
            raise ValueError(f"unknown signal {right_key!r} in condition {condition!r}")

    ops = {">=": pd.Series.ge, "<=": pd.Series.le, ">": pd.Series.gt, "<": pd.Series.lt, "==": pd.Series.eq}
    return ops[op](left, right)


def _combine_conditions(conditions: list[str], signals: dict[str, pd.Series], close: pd.Series) -> pd.Series:
    parts = [c.strip() for raw in conditions for c in raw.split("AND")]
    result = _eval_condition(parts[0], signals, close)
    for part in parts[1:]:
        result = result & _eval_condition(part, signals, close)
    return result.fillna(False)


_TIMEFRAME_FREQ = {"1D": "1D", "1W": "7D", "1M": "30D"}


def _run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]):
    import vectorbt as vbt

    portfolios = []
    n_assets = len(spec.assets)
    freq = _TIMEFRAME_FREQ.get(spec.timeframe, "1D")

    for symbol in spec.assets:
        df = bars[symbol]
        close = df["close"]
        signals = _compute_indicators(df, spec)

        entries = _combine_conditions(spec.entry_conditions, signals, close)
        exits = _combine_conditions(spec.exit_conditions, signals, close)

        ps = spec.position_sizing
        if ps == "equal_weight":
            size = 1.0 / n_assets
            size_type = "amount"
        elif ps == "percent_equity":
            size = 0.95
            size_type = "percent"
        else:
            size = 1.0
            size_type = "amount"

        kwargs: dict = dict(close=close, entries=entries, exits=exits, size=size, freq=freq)
        if spec.risk_params.stop_loss_pct is not None:
            kwargs["sl_stop"] = spec.risk_params.stop_loss_pct / 100
        if spec.risk_params.take_profit_pct is not None:
            kwargs["tp_stop"] = spec.risk_params.take_profit_pct / 100
        if ps == "percent_equity":
            kwargs["size_type"] = size_type

        portfolios.append(vbt.Portfolio.from_signals(**kwargs))

    if len(portfolios) == 1:
        return portfolios[0]
    return vbt.Portfolio.concat(portfolios)


async def run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_backtest, spec, bars)
