"""Persist provider operations separately from the workflow's task transitions."""

from contextlib import closing
from dataclasses import asdict
import json
from pathlib import Path
import sqlite3

from .ports import Event, Handle, ProviderError


def _encode(event: Event) -> str:
    return json.dumps(asdict(event), ensure_ascii=False, allow_nan=False)


class Journal:
    def __init__(self, database: Path) -> None:
        self.database = database
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS provider_operations ("
                "id TEXT PRIMARY KEY, route TEXT NOT NULL, event TEXT, action TEXT)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database, timeout=30)

    def read(self, key: str, route: str) -> tuple[Event | None, str | None]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT route, event, action FROM provider_operations WHERE id = ?", (key,)
            ).fetchone()
        if row is None:
            return None, None
        if row[0] != route:
            raise ProviderError("the persisted attempt belongs to a different provider route")
        if row[1] is None:
            return None, row[2]
        data = json.loads(row[1])
        data["handle"] = Handle(**data["handle"])
        data["artifacts"] = tuple(data["artifacts"])
        return Event(**data), row[2]

    def usage(self, key: str) -> dict[str, int]:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT event FROM provider_operations WHERE id = ?", (key,)).fetchone()
        if row is None or row[0] is None:
            raise ProviderError("provider has no saved usage for this attempt")
        return json.loads(row[0])["usage"]

    def reserve(self, key: str, route: str) -> bool:
        with closing(self._connect()) as connection, connection:
            return connection.execute(
                "INSERT OR IGNORE INTO provider_operations VALUES (?, ?, NULL, 'submit')", (key, route),
            ).rowcount == 1

    def begin_action(self, key: str, route: str, action: str) -> None:
        with closing(self._connect()) as connection, connection:
            written = connection.execute(
                "UPDATE provider_operations SET action = ? WHERE id = ? AND route = ? "
                "AND event IS NOT NULL AND action IS NULL", (action, key, route),
            ).rowcount
        if written != 1:
            raise ProviderError("a provider operation already requires reconciliation")

    def save(
        self, key: str, route: str, event: Event, *, action: str | None = None,
        previous: Event | None = None,
    ) -> bool:
        serialized = _encode(event)
        query = (
            "UPDATE provider_operations SET event = ?, action = NULL "
            "WHERE id = ? AND route = ? AND action IS ?"
        )
        params = (serialized, key, route, action)
        if previous is not None:
            query += " AND event = ?"
            params += (_encode(previous),)
        with closing(self._connect()) as connection, connection:
            return connection.execute(query, params).rowcount == 1
