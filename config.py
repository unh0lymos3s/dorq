from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "dorq"
    debug: bool = False
    log_level: Literal["debug", "info", "warning", "error", "critical"] = "info"
    cors_origins: list[str] = ["*"]

    # --- LLM: local Ollama on the host machine ---
    # The server talks to a single Ollama instance; no provider/key is taken
    # from the client. Override the model/host via DORQ_OLLAMA_* env vars.
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "minimax-m3:cloud"
    # Per-request LLM timeout in seconds. Cloud / large local models can be
    # slow to first token, so this is generous by default.
    llm_timeout: int = 600

    # --- Alpaca market data (read from env, never from the client) ---
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""

    @property
    def alpaca_configured(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)

    model_config = {"env_prefix": "DORQ_"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
