from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from smartsku_backend.config import DatabaseConfig
from smartsku_backend.db.models import Base


class Database:
    def __init__(self, config: DatabaseConfig) -> None:
        self._config = config
        self._engine: AsyncEngine = create_async_engine(
            config.url, echo=config.echo, connect_args={"timeout": config.busy_timeout_seconds}
        )
        event.listen(self._engine.sync_engine, "connect", self._configure_connection)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory

    async def create_schema(self) -> None:
        # Prototype stage: no migrations yet, tables are created on startup.
        self._config.path.parent.mkdir(parents=True, exist_ok=True)
        async with self._engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self._engine.dispose()

    def _configure_connection(self, dbapi_connection: Any, connection_record: Any) -> None:
        # WAL lets the REST API read while the MQTT gateway writes telemetry.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
