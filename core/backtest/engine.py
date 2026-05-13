import asyncio
import re

import pandas as pd
import pandas_ta  # noqa: F401 — registers df.ta accessor

from core.models.strategy import PortfolioConfig, StrategySpec

_CONDITION_RE = re.compile(
    r"^(?P<left>\w+)\s*(?P<op>>=|<=|>|<|==)\s*(?P<right>[\w.]+)$"
)

# Proper pandas offset aliases for vectorbt annualization
_TIMEFRAME_FREQ = {"1D": "D", "1W": "W", "1M": "M"}

_AND_RE = re.compile(r"\bAND\b", re.IGNORECASE)


def _compute_indicators(df: pd.DataFrame, spec: StrategySpec) -> dict[str, pd.Series]:
    signals: dict[str, pd.Series] = {
        "close": df["close"],
        "open": df["open"],
        "high": df["high"],
        "low": df["low"],
    }

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


def _eval_condition(condition: str, signals: dict[str, pd.Series]) -> pd.Series:
    m = _CONDITION_RE.match(condition.strip())
    if not m:
        raise ValueError(f"unparseable condition: {condition!r}")

    left_key = m.group("left")
    op = m.group("op")
    right_key = m.group("right")

    left = signals.get(left_key)
    if left is None:
        raise ValueError(f"unknown signal {left_key!r} in condition {condition!r}")

    try:
        right: pd.Series | float = float(right_key)
    except ValueError:
        right = signals.get(right_key)
        if right is None:
            raise ValueError(f"unknown signal {right_key!r} in condition {condition!r}")

    ops = {
        ">=": pd.Series.ge,
        "<=": pd.Series.le,
        ">": pd.Series.gt,
        "<": pd.Series.lt,
        "==": pd.Series.eq,
    }
    return ops[op](left, right)


def _combine_conditions(conditions: list[str], signals: dict[str, pd.Series]) -> pd.Series:
    """AND-join all condition tokens across all entries. Only AND is supported."""
    parts = [token.strip() for raw in conditions for token in _AND_RE.split(raw) if token.strip()]
    result = _eval_condition(parts[0], signals)
    for part in parts[1:]:
        result = result & _eval_condition(part, signals)
    return result.fillna(False)


def _run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]):
    import vectorbt as vbt

    freq = _TIMEFRAME_FREQ.get(spec.timeframe, "D")
    ps = spec.position_sizing
    n_assets = len(spec.assets)

    # Build vectorized 2D arrays — one column per asset
    closes: dict[str, pd.Series] = {}
    entries_map: dict[str, pd.Series] = {}
    exits_map: dict[str, pd.Series] = {}

    for symbol in spec.assets:
        df = bars[symbol]
        signals = _compute_indicators(df, spec)
        closes[symbol] = df["close"]
        entries_map[symbol] = _combine_conditions(spec.entry_conditions, signals)
        exits_map[symbol] = _combine_conditions(spec.exit_conditions, signals)

    close_df = pd.concat(closes, axis=1).ffill()
    entries_df = pd.concat(entries_map, axis=1).fillna(False)
    exits_df = pd.concat(exits_map, axis=1).fillna(False)

    if ps == "equal_weight":
        size = 1.0 / n_assets
        size_type = "percent"
    elif ps == "percent_equity":
        size = 0.95
        size_type = "percent"
    else:  # fixed — 1 share per signal
        size = 1.0
        size_type = "amount"

    kwargs: dict = dict(
        close=close_df,
        entries=entries_df,
        exits=exits_df,
        size=size,
        size_type=size_type,
        freq=freq,
        group_by=True,
        cash_sharing=(ps in ("equal_weight", "percent_equity")),
    )
    if spec.risk_params.stop_loss_pct is not None:
        kwargs["sl_stop"] = spec.risk_params.stop_loss_pct / 100
    if spec.risk_params.take_profit_pct is not None:
        kwargs["tp_stop"] = spec.risk_params.take_profit_pct / 100

    return vbt.Portfolio.from_signals(**kwargs)


async def run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _run_backtest, spec, bars)


def _run_backtest_from_code(
    portfolio_config: PortfolioConfig,
    strategy_code: str,
    bars: dict[str, pd.DataFrame],
):
    import vectorbt as vbt
    from core.backtest.executor import exec_strategy

    entries_df, exits_df = exec_strategy(strategy_code, bars)

    entries_df = entries_df[portfolio_config.assets]
    exits_df = exits_df[portfolio_config.assets]

    freq = _TIMEFRAME_FREQ.get(portfolio_config.timeframe, "D")
    ps = portfolio_config.position_sizing
    n_assets = len(portfolio_config.assets)

    close_df = pd.concat(
        {s: bars[s]["close"] for s in portfolio_config.assets}, axis=1
    ).ffill()

    if ps == "equal_weight":
        size = 1.0 / n_assets
        size_type = "percent"
    elif ps == "percent_equity":
        size = 0.95
        size_type = "percent"
    else:
        size = 1.0
        size_type = "amount"

    kwargs: dict = dict(
        close=close_df,
        entries=entries_df,
        exits=exits_df,
        size=size,
        size_type=size_type,
        freq=freq,
        group_by=True,
        cash_sharing=(ps in ("equal_weight", "percent_equity")),
    )
    if portfolio_config.risk_params.stop_loss_pct is not None:
        kwargs["sl_stop"] = portfolio_config.risk_params.stop_loss_pct / 100
    if portfolio_config.risk_params.take_profit_pct is not None:
        kwargs["tp_stop"] = portfolio_config.risk_params.take_profit_pct / 100

    return vbt.Portfolio.from_signals(**kwargs)


async def run_backtest_from_code(
    portfolio_config: PortfolioConfig,
    strategy_code: str,
    bars: dict[str, pd.DataFrame],
):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _run_backtest_from_code, portfolio_config, strategy_code, bars
    )
