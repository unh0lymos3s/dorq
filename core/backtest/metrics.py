import base64

import plotly.io as pio


def extract_metrics(portfolio) -> dict[str, float | None]:
    def _get(fn):
        try:
            val = fn()
            if hasattr(val, "item"):
                val = val.item()
            return round(float(val), 4) if val is not None else None
        except Exception:
            return None

    stats = portfolio.stats()

    return {
        "total_return": _get(lambda: stats.get("Total Return [%]")),
        "annualized_return": _get(lambda: stats.get("Annualized Return [%]")),
        "sharpe_ratio": _get(lambda: stats.get("Sharpe Ratio")),
        "sortino_ratio": _get(lambda: stats.get("Sortino Ratio")),
        "max_drawdown": _get(lambda: stats.get("Max Drawdown [%]")),
        "win_rate": _get(lambda: stats.get("Win Rate [%]")),
        "num_trades": _get(lambda: stats.get("Total Trades")),
    }


def render_charts(portfolio) -> list[str]:
    charts = []
    try:
        fig = portfolio.plot()
        png_bytes = pio.to_image(fig, format="png")
        charts.append(base64.b64encode(png_bytes).decode())
    except Exception:
        pass
    return charts
