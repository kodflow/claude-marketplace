"""Persist provider operations separately from the workflow's task transitions."""

from collections.abc import Callable
from contextlib import closing
from dataclasses import asdict
import json
from pathlib import Path
import sqlite3

from .ports import Event, Handle, ProviderError


def _encode(event: Event) -> str:
    return json.dumps(asdict(event), ensure_ascii=False, allow_nan=False)


def operation_key(idempotency_key: str, attempt: int) -> str:
    """Keep logical provider idempotency while giving each attempt its own journal row."""
    # Attempt one retains the key from databases written before retry-aware journaling.
    return idempotency_key if attempt == 1 else f"{idempotency_key}:{attempt}"


class Journal:
    def __init__(self, database: Path) -> None:
        self.database = database
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS provider_operations ("
                "id TEXT PRIMARY KEY, route TEXT NOT NULL, event TEXT, action TEXT, "
                "revision INTEGER NOT NULL DEFAULT 0, last_action TEXT)"
            )
            columns = {column[1] for column in connection.execute("PRAGMA table_info(provider_operations)")}
            if "revision" not in columns:
                connection.execute("ALTER TABLE provider_operations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
            if "last_action" not in columns:
                connection.execute("ALTER TABLE provider_operations ADD COLUMN last_action TEXT")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database, timeout=30)

    def read(self, key: str, route: str) -> tuple[Event | None, str | None]:
        event, action, _ = self.read_revision(key, route)
        return event, action

    def read_revision(self, key: str, route: str) -> tuple[Event | None, str | None, int]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT route, event, action, revision FROM provider_operations WHERE id = ?", (key,)
            ).fetchone()
        if row is None:
            return None, None, 0
        if row[0] != route:
            raise ProviderError("the persisted attempt belongs to a different provider route")
        if row[1] is None:
            return None, row[2], row[3]
        data = json.loads(row[1])
        data["handle"] = Handle(**data["handle"])
        data["artifacts"] = tuple(data["artifacts"])
        return Event(**data), row[2], row[3]

    def usage(self, key: str) -> dict[str, int]:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT event FROM provider_operations WHERE id = ?", (key,)).fetchone()
        if row is None or row[0] is None:
            raise ProviderError("provider has no saved usage for this attempt")
        return json.loads(row[0])["usage"]

    def reserve(
        self, key: str, route: str, *, guard: Callable[[sqlite3.Connection], None] | None = None,
    ) -> bool:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            if guard is not None:
                guard(connection)
            return connection.execute(
                "INSERT OR IGNORE INTO provider_operations (id, route, event, action) "
                "VALUES (?, ?, NULL, 'submit')", (key, route),
            ).rowcount == 1

    def begin_action(
        self, key: str, route: str, action: str, *, revision: int,
        guard: Callable[[sqlite3.Connection], None] | None = None,
    ) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            if guard is not None:
                guard(connection)
            written = connection.execute(
                "UPDATE provider_operations SET action = ? WHERE id = ? AND route = ? "
                "AND event IS NOT NULL AND action IS NULL AND revision = ?",
                (action, key, route, revision),
            ).rowcount
        if written != 1:
            raise ProviderError("provider checkpoint changed or an operation requires reconciliation")

    def release_unsent(self, key: str, route: str, action: str, *, revision: int) -> None:
        """Clear only a matching reservation whose provider confirms no send."""
        if action == "submit":
            query = "DELETE FROM provider_operations WHERE event IS NULL"
        else:
            query = "UPDATE provider_operations SET action = NULL WHERE event IS NOT NULL"
        with closing(self._connect()) as connection, connection:
            written = connection.execute(
                query + " AND id = ? AND route = ? AND action = ? AND revision = ?",
                (key, route, action, revision),
            ).rowcount
        if written != 1:
            raise ProviderError("provider operation changed before its unsent reservation could be released")

    def confirmed(self, key: str, route: str, action: str, *, revision: int) -> bool:
        """Recognize a persisted operator action whose local transition was interrupted."""
        with closing(self._connect()) as connection:
            return connection.execute(
                "SELECT 1 FROM provider_operations WHERE id = ? AND route = ? AND revision = ? "
                "AND last_action = ? AND action IS NULL",
                (key, route, revision, action),
            ).fetchone() is not None

    def save(
        self, key: str, route: str, event: Event, *, action: str | None = None,
        revision: int,
    ) -> bool:
        serialized = _encode(event)
        query = (
            "UPDATE provider_operations SET event = ?, last_action = action, action = NULL, revision = revision + 1 "
            "WHERE id = ? AND route = ? AND action IS ? AND revision = ?"
        )
        with closing(self._connect()) as connection, connection:
            return connection.execute(query, (serialized, key, route, action, revision)).rowcount == 1
