from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "dorq"
    debug: bool = False
    log_level: str = "info"

    model_config = {"env_prefix": "DORQ_"}


settings = Settings()
