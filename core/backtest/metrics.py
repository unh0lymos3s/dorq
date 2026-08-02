"""Turn a vectorbt Portfolio into JSON-safe analytics for BacktestResult.

Everything here is blocking pandas/numpy work — callers must run it in a
thread pool (``run_in_executor``), never directly on the event loop.

Unit conventions (mirrored by the UI):
  - *_return, *_pct, max_drawdown, win_rate, volatility → percent points
    (e.g. ``12.34`` means 12.34%).
  - Ratios (sharpe, sortino, calmar, profit_factor) → plain floats.
"""
import logging

import pandas as pd

logger = logging.getLogger(__name__)

# Explicit subset of vectorbt's default stats — excludes "profit_factor" and
# "expectancy", whose calc_func mutates a numpy array in place and raises
# "ValueError: assignment destination is read-only" against current
# numpy/pandas (read-only views), reproducible with any ungrouped/non-shared
# portfolio (position_sizing="fixed"). Profit factor is recomputed manually
# from the trade list in _trade_stats instead.
_STATS_METRICS = [
    "total_return", "period", "sharpe_ratio", "sortino_ratio", "calmar_ratio",
    "max_dd", "win_rate", "total_trades",
]


def build_analytics(portfolio, bars: dict[str, pd.DataFrame], init_cash: float) -> dict:
    """Compute every analytics field of a BacktestResult in one pass.

    Returns a dict with keys ``metrics``, ``equity_curve``, ``benchmark_curve``,
    ``drawdown_curve`` and ``trades``, ready to splat into BacktestResult.
    """
    trades = extract_trades(portfolio)
    equity = _total_equity(portfolio)

    metrics = extract_metrics(portfolio)
    metrics.update(_trade_stats(trades))

    benchmark_curve = compute_benchmark_curve(bars, init_cash)
    if benchmark_curve:
        first, last = benchmark_curve[0]["v"], benchmark_curve[-1]["v"]
        if first > 0:
            metrics["benchmark_return"] = round((last / first - 1) * 100, 4)

    return {
        "metrics": metrics,
        "equity_curve": _series_to_points(equity),
        "benchmark_curve": benchmark_curve,
        "drawdown_curve": _series_to_points(_drawdown_pct(equity)),
        "trades": trades,
    }


# ---------------------------------------------------------------------------
# Portfolio-level metrics
# ---------------------------------------------------------------------------

def extract_metrics(portfolio) -> dict[str, float | int | None]:
    def _get_float(key: str) -> float | None:
        try:
            val = stats.get(key)
            if val is None:
                return None
            if hasattr(val, "item"):
                val = val.item()
            return round(float(val), 4)
        except Exception:
            return None

    def _get_int(key: str) -> int | None:
        try:
            val = stats.get(key)
            if val is None:
                return None
            if hasattr(val, "item"):
                val = val.item()
            return int(val)
        except Exception:
            return None

    stats = portfolio.stats(metrics=_STATS_METRICS)

    # When position_sizing is "fixed", portfolio.stats() returns a DataFrame
    # (one column per asset) rather than a Series.  Reduce to a single Series
    # by averaging across assets so the _get_float/_get_int helpers can use
    # .get() and scalar arithmetic safely.
    if isinstance(stats, pd.DataFrame):
        stats = stats.mean(axis=1)

    ann = _get_float("Annualized Return [%]")
    if ann is None:
        # Compute manually from Total Return and Period when vbt omits the key.
        total = stats.get("Total Return [%]")
        period = stats.get("Period")
        if total is not None and period is not None:
            try:
                years = period.days / 365.25
                if years > 0:
                    ann = round(((1 + float(total) / 100) ** (1 / years) - 1) * 100, 4)
            except Exception:
                pass

    volatility = None
    try:
        vol = portfolio.annualized_volatility()
        if isinstance(vol, pd.Series):
            vol = vol.mean()
        # annualized_volatility() returns a fraction (e.g. 0.137); store as
        # percent points to match the other "[%]" stats.
        volatility = round(float(vol) * 100, 4)
    except Exception:
        logger.exception("annualized_volatility computation failed")

    return {
        "total_return": _get_float("Total Return [%]"),
        "annualized_return": ann,
        "sharpe_ratio": _get_float("Sharpe Ratio"),
        "sortino_ratio": _get_float("Sortino Ratio"),
        "calmar_ratio": _get_float("Calmar Ratio"),
        "max_drawdown": _get_float("Max Drawdown [%]"),
        "win_rate": _get_float("Win Rate [%]"),
        "num_trades": _get_int("Total Trades"),
        "volatility": volatility,
    }


def _trade_stats(trades: list[dict]) -> dict[str, float | None]:
    """Profit factor and win/loss distribution from closed trades."""
    closed = [t for t in trades if t["status"] == "closed" and t["pnl"] is not None]
    if not closed:
        return {
            "profit_factor": None, "avg_win_pct": None, "avg_loss_pct": None,
            "best_trade_pct": None, "worst_trade_pct": None,
        }

    gross_win = sum(t["pnl"] for t in closed if t["pnl"] > 0)
    gross_loss = -sum(t["pnl"] for t in closed if t["pnl"] < 0)
    profit_factor = round(gross_win / gross_loss, 4) if gross_loss > 0 else None

    rets = [t["return_pct"] for t in closed if t["return_pct"] is not None]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]

    def _avg(xs: list[float]) -> float | None:
        return round(sum(xs) / len(xs), 4) if xs else None

    return {
        "profit_factor": profit_factor,
        "avg_win_pct": _avg(wins),
        "avg_loss_pct": _avg(losses),
        "best_trade_pct": round(max(rets), 4) if rets else None,
        "worst_trade_pct": round(min(rets), 4) if rets else None,
    }


# ---------------------------------------------------------------------------
# Time-series curves
# ---------------------------------------------------------------------------

def _total_equity(portfolio) -> pd.Series:
    """Total portfolio value over time, summed across assets when ungrouped."""
    value = portfolio.value()
    if isinstance(value, pd.DataFrame):
        value = value.sum(axis=1)
    return value


def _drawdown_pct(equity: pd.Series) -> pd.Series:
    """Drawdown from running peak, in percent points (0 or negative)."""
    peak = equity.cummax()
    return (equity / peak - 1.0) * 100


def _series_to_points(series: pd.Series) -> list[dict]:
    return [
        {"t": ts.isoformat(), "v": round(float(v), 4)}
        for ts, v in series.items()
        if pd.notna(v)
    ]


def compute_benchmark_curve(bars: dict[str, pd.DataFrame], init_cash: float) -> list[dict]:
    """Equal-weight buy-and-hold of the same assets, scaled to init_cash.

    This is the baseline the strategy has to beat: put init_cash into the
    traded universe on day one and never touch it.
    """
    if not bars:
        return []
    normalized = []
    for df in bars.values():
        close = df["close"].dropna()
        if close.empty or close.iloc[0] == 0:
            continue
        normalized.append(close / close.iloc[0])
    if not normalized:
        return []
    combined = pd.concat(normalized, axis=1).ffill().mean(axis=1) * init_cash
    return _series_to_points(combined)


def extract_price_series(price_data: dict[str, pd.DataFrame]) -> dict[str, list[dict]]:
    """Per-asset close-price time series — the market data the chart draws."""
    series: dict[str, list[dict]] = {}
    for symbol, df in price_data.items():
        close = df["close"]
        series[symbol] = [
            {"t": ts.isoformat(), "c": round(float(v), 4)}
            for ts, v in close.items()
        ]
    return series


def extract_trades(portfolio) -> list[dict]:
    """Simulated entries/exits from the portfolio, keyed by asset symbol."""
    try:
        records = portfolio.trades.records_readable
    except Exception:
        logger.exception("extract_trades failed")
        return []

    trades: list[dict] = []
    for _, row in records.iterrows():
        try:
            exit_ts = row.get("Exit Timestamp")
            exit_price = row.get("Avg Exit Price")
            pnl = row.get("PnL")
            ret = row.get("Return")
            trades.append({
                "asset": str(row["Column"]),
                "side": "short" if str(row.get("Direction", "")).lower() == "short" else "long",
                "status": "closed" if str(row.get("Status", "")).lower() == "closed" else "open",
                "entry_time": pd.Timestamp(row["Entry Timestamp"]).isoformat(),
                "entry_price": round(float(row["Avg Entry Price"]), 4),
                "exit_time": pd.Timestamp(exit_ts).isoformat() if pd.notna(exit_ts) else None,
                "exit_price": round(float(exit_price), 4) if pd.notna(exit_price) else None,
                "pnl": round(float(pnl), 4) if pd.notna(pnl) else None,
                "return_pct": round(float(ret) * 100, 4) if pd.notna(ret) else None,
            })
        except Exception:
            logger.exception("extract_trades: skipping unreadable trade row")
    return trades
