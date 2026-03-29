"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """App settings — reads from .env file or environment variables."""

    # Database
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "finance_user"
    DB_PASSWORD: str = "finance_pass"
    DB_NAME: str = "finance_app"

    # App
    APP_NAME: str = "Personal Finance Manager"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # CORS
    FRONTEND_URL: str = "http://localhost:5173"

    @property
    def database_url(self) -> str:
        """Async database URL for SQLAlchemy."""
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
