"""DB-agnostic SQL expression helpers."""
from sqlalchemy import func
from app.config import settings


def month_col(date_column):
    """Return a YYYY-MM string expression compatible with SQLite and MariaDB."""
    if settings.is_sqlite:
        return func.strftime("%Y-%m", date_column)
    return func.date_format(date_column, "%Y-%m")
