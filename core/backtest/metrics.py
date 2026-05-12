import base64
import logging

import plotly.io as pio

logger = logging.getLogger(__name__)


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

    stats = portfolio.stats()

    return {
        "total_return": _get_float("Total Return [%]"),
        "annualized_return": _get_float("Annualized Return [%]"),
        "sharpe_ratio": _get_float("Sharpe Ratio"),
        "sortino_ratio": _get_float("Sortino Ratio"),
        "max_drawdown": _get_float("Max Drawdown [%]"),
        "win_rate": _get_float("Win Rate [%]"),
        "num_trades": _get_int("Total Trades"),
    }


def render_charts(portfolio) -> list[str]:
    charts = []
    try:
        fig = portfolio.plot()
        png_bytes = pio.to_image(fig, format="png")
        charts.append(base64.b64encode(png_bytes).decode())
    except Exception:
        logger.exception("chart rendering failed")
    return charts
