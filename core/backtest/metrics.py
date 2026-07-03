import base64
import io
import logging

import pandas as pd
import plotly.io as pio

logger = logging.getLogger(__name__)

# Explicit subset of vectorbt's default stats — excludes "profit_factor" and
# "expectancy", whose calc_func mutates a numpy array in place and raises
# "ValueError: assignment destination is read-only" against current
# numpy/pandas (read-only views), reproducible with any ungrouped/non-shared
# portfolio (position_sizing="fixed"). None of the excluded metrics are used
# in the returned payload anyway.
_STATS_METRICS = [
    "total_return", "period", "sharpe_ratio", "sortino_ratio", "calmar_ratio",
    "max_dd", "win_rate", "total_trades",
]


def extract_metrics(
    portfolio,
    price_data: dict[str, pd.DataFrame] | None = None,
) -> dict[str, float | int | None | str]:
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
        # percentage points to match the other "[%]" stats (max_drawdown, win_rate).
        volatility = round(float(vol) * 100, 4)
    except Exception:
        logger.exception("annualized_volatility computation failed")

    result: dict[str, float | int | None | str] = {
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

    if price_data is not None:
        try:
            chart_b64 = portfolio_vs_candles_chart(portfolio, price_data)
            result["portfolio_vs_candles_chart"] = chart_b64
        except Exception:
            logger.exception("portfolio_vs_candles_chart rendering failed")

    return result


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


def render_charts(portfolio) -> list[str]:
    charts = []
    try:
        fig = portfolio.plot()
        png_bytes = pio.to_image(fig, format="png")
        charts.append(base64.b64encode(png_bytes).decode())
    except Exception:
        logger.exception("chart rendering failed")
    return charts


def portfolio_vs_candles_chart(
    portfolio,
    price_data: dict[str, pd.DataFrame],
) -> str:
    """Return base64-encoded PNG: portfolio cumulative returns plotted against
    the first asset's close price on a dual y-axis chart.

    Left axis: portfolio cumulative return (%).
    Right axis: close price of the first symbol in price_data.
    Style: dark background (#0d0d0d), portfolio line in #00ff88, price line in #888888.
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # --- portfolio cumulative returns ---
    try:
        cum_returns: pd.Series = portfolio.cumulative_returns() * 100
        if isinstance(cum_returns, pd.DataFrame):
            # multi-asset: average across columns
            cum_returns = cum_returns.mean(axis=1)
    except Exception:
        logger.exception("portfolio_vs_candles_chart: failed to compute cumulative returns")
        raise

    # --- first asset close price ---
    first_symbol = next(iter(price_data))
    close_price: pd.Series = price_data[first_symbol]["close"]

    # Align to the intersection of both indices
    common_idx = cum_returns.index.intersection(close_price.index)
    cum_returns = cum_returns.loc[common_idx]
    close_price = close_price.loc[common_idx]

    # --- plot ---
    bg = "#0d0d0d"
    fig, ax1 = plt.subplots(figsize=(12, 5), facecolor=bg)
    ax1.set_facecolor(bg)

    ax1.plot(cum_returns.index, cum_returns.values, color="#00ff88", linewidth=1.5, label="Portfolio Return %")
    ax1.set_ylabel("Cumulative Return (%)", color="#00ff88", fontsize=10)
    ax1.tick_params(axis="y", colors="#00ff88")
    ax1.tick_params(axis="x", colors="#888888")
    ax1.spines["bottom"].set_color("#333333")
    ax1.spines["left"].set_color("#00ff88")
    ax1.spines["top"].set_visible(False)
    ax1.spines["right"].set_visible(False)
    ax1.grid(axis="y", color="#1a1a1a", linewidth=0.5)

    ax2 = ax1.twinx()
    ax2.set_facecolor(bg)
    ax2.plot(close_price.index, close_price.values, color="#888888", linewidth=1.0, alpha=0.7, label=f"{first_symbol} Close")
    ax2.set_ylabel(f"{first_symbol} Close Price", color="#888888", fontsize=10)
    ax2.tick_params(axis="y", colors="#888888")
    ax2.spines["bottom"].set_color("#333333")
    ax2.spines["right"].set_color("#888888")
    ax2.spines["top"].set_visible(False)
    ax2.spines["left"].set_visible(False)

    # Combined legend
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, facecolor="#111111", edgecolor="#333333",
               labelcolor="white", fontsize=9, loc="upper left")

    fig.patch.set_facecolor(bg)
    plt.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=100, facecolor=bg, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()
