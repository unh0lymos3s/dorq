import logging

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

_SCRUB_KEYS = frozenset({
    "api_key", "alpaca_api_key", "alpaca_secret_key",
    "secret_key", "authorization", "cookie",
})


def _before_send(event: dict, hint: dict) -> dict:
    """Strip sensitive keys from request body and extra data before sending to Sentry."""
    request = event.get("request", {})
    body = request.get("data")
    if isinstance(body, dict):
        request["data"] = {
            k: "[Filtered]" if k.lower() in _SCRUB_KEYS else v
            for k, v in body.items()
        }
    return event


def init(dsn: str, environment: str, traces_sample_rate: float) -> None:
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        before_send=_before_send,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
            LoggingIntegration(
                level=logging.INFO,         # breadcrumbs for INFO and above
                event_level=logging.ERROR,  # Sentry events for ERROR and above
            ),
        ],
    )
