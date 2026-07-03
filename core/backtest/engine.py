import asyncio
import re

import pandas as pd
import pandas_ta  # noqa: F401 — registers df.ta accessor

from core.models.strategy import PortfolioConfig, StrategySpec

_CONDITION_RE = re.compile(
    r"^(?P<left>\w+)\s*(?P<op>>=|<=|>|<|==)\s*(?P<right>[\w.]+)$"
)

_TIMEFRAME_FREQ = {"1D": "D", "1W": "W", "1M": "ME"}

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


def _vbt_kwargs(
    close_df: pd.DataFrame,
    entries_df: pd.DataFrame,
    exits_df: pd.DataFrame,
    position_sizing: str,
    timeframe: str,
    risk_params,
    init_cash: float = 100_000.0,
) -> dict:
    freq = _TIMEFRAME_FREQ.get(timeframe, "D")
    n_assets = len(close_df.columns)
    shared = position_sizing in ("equal_weight", "percent_equity")

    if position_sizing == "equal_weight":
        size, size_type = 1.0 / n_assets, "percent"
    elif position_sizing == "percent_equity":
        size, size_type = 0.95, "percent"
    else:
        size, size_type = 1.0, "amount"

    kwargs: dict = dict(
        close=close_df,
        entries=entries_df,
        exits=exits_df,
        size=size,
        size_type=size_type,
        freq=freq,
        group_by=shared,
        cash_sharing=shared,
        init_cash=init_cash,
    )
    if risk_params.stop_loss_pct is not None:
        kwargs["sl_stop"] = risk_params.stop_loss_pct / 100
    if risk_params.take_profit_pct is not None:
        kwargs["tp_stop"] = risk_params.take_profit_pct / 100
    return kwargs


def _run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]):
    import vectorbt as vbt

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

    return vbt.Portfolio.from_signals(
        **_vbt_kwargs(
            close_df, entries_df, exits_df, spec.position_sizing, spec.timeframe, spec.risk_params,
            init_cash=spec.init_cash,
        )
    )


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

    missing = [s for s in portfolio_config.assets if s not in entries_df.columns]
    if missing:
        raise ValueError(f"strategy() did not produce columns for assets: {missing}")

    entries_df = entries_df.reindex(columns=portfolio_config.assets, fill_value=False)
    exits_df = exits_df.reindex(columns=portfolio_config.assets, fill_value=False)

    close_df = pd.concat(
        {s: bars[s]["close"] for s in portfolio_config.assets}, axis=1
    ).ffill()

    return vbt.Portfolio.from_signals(
        **_vbt_kwargs(
            close_df, entries_df, exits_df,
            portfolio_config.position_sizing, portfolio_config.timeframe, portfolio_config.risk_params,
            init_cash=portfolio_config.init_cash,
        )
    )


async def run_backtest_from_code(
    portfolio_config: PortfolioConfig,
    strategy_code: str,
    bars: dict[str, pd.DataFrame],
):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _run_backtest_from_code, portfolio_config, strategy_code, bars
    )
