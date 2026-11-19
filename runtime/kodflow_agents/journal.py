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
                "revision INTEGER NOT NULL DEFAULT 0, last_action TEXT, "
                "action_decision INTEGER, last_action_decision INTEGER)"
            )
            columns = {column[1] for column in connection.execute("PRAGMA table_info(provider_operations)")}
            if "revision" not in columns:
                connection.execute("ALTER TABLE provider_operations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
            if "last_action" not in columns:
                connection.execute("ALTER TABLE provider_operations ADD COLUMN last_action TEXT")
            for name in ("action_decision", "last_action_decision"):
                if name not in columns:
                    connection.execute(f"ALTER TABLE provider_operations ADD COLUMN {name} INTEGER")

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
        decision: bool | None = None,
        guard: Callable[[sqlite3.Connection], None] | None = None,
    ) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            if guard is not None:
                guard(connection)
            written = connection.execute(
                "UPDATE provider_operations SET action = ?, action_decision = ? WHERE id = ? AND route = ? "
                "AND event IS NOT NULL AND action IS NULL AND revision = ?",
                (action, decision, key, route, revision),
            ).rowcount
        if written != 1:
            raise ProviderError("provider checkpoint changed or an operation requires reconciliation")

    def mark_submit_unknown(self, key: str, route: str, *, revision: int) -> None:
        """Distinguish an observed ambiguous failure from a worker still submitting."""
        with closing(self._connect()) as connection, connection:
            written = connection.execute(
                "UPDATE provider_operations SET action = 'submit_unknown' "
                "WHERE id = ? AND route = ? AND revision = ? AND action = 'submit'",
                (key, route, revision),
            ).rowcount
        if written != 1:
            raise ProviderError("provider submission reservation changed before recording its unknown outcome")

    def release_unprocessed(self, key: str, route: str, action: str, *, revision: int) -> None:
        """Clear a matching reservation after a pre-send failure or proven rejection."""
        if action == "submit":
            query = "DELETE FROM provider_operations WHERE event IS NULL"
        else:
            query = "UPDATE provider_operations SET action = NULL, action_decision = NULL WHERE event IS NOT NULL"
        with closing(self._connect()) as connection, connection:
            written = connection.execute(
                query + " AND id = ? AND route = ? AND action = ? AND revision = ?",
                (key, route, action, revision),
            ).rowcount
        if written != 1:
            raise ProviderError("provider operation changed before its reservation could be released")

    def confirmed(
        self, key: str, route: str, action: str, *, revision: int, decision: bool | None = None,
    ) -> bool:
        """Recognize a persisted operator action whose local transition was interrupted."""
        with closing(self._connect()) as connection:
            return connection.execute(
                "SELECT 1 FROM provider_operations WHERE id = ? AND route = ? AND revision = ? "
                "AND last_action = ? AND last_action_decision IS ? AND action IS NULL",
                (key, route, revision, action, decision),
            ).fetchone() is not None

    @staticmethod
    def allows_expiry(connection: sqlite3.Connection, key: str, route: str) -> bool:
        """Recheck absence or terminal failure under the workflow's expiry write lock."""
        row = connection.execute(
            "SELECT route, action, event FROM provider_operations WHERE id = ?", (key,)
        ).fetchone()
        if row is None:
            return True
        if row[0] != route or row[1] is not None or row[2] is None:
            return False
        event = json.loads(row[2])
        return event["state"] in {"failed", "cancelled"} and event.get("retryable_on_expiry", True)

    @staticmethod
    def checkpoint_current(
        connection: sqlite3.Connection, key: str, route: str, revision: int, state: str,
    ) -> bool:
        """Prevent replay of a waiting event while its provider revision changes."""
        row = connection.execute(
            "SELECT event FROM provider_operations WHERE id = ? AND route = ? "
            "AND revision = ? AND action IS NULL",
            (key, route, revision),
        ).fetchone()
        return row is not None and row[0] is not None and json.loads(row[0])["state"] == state

    def save(
        self, key: str, route: str, event: Event, *, action: str | None = None,
        revision: int,
    ) -> bool:
        serialized = _encode(event)
        query = (
            "UPDATE provider_operations SET event = ?, last_action = action, "
            "last_action_decision = action_decision, action = NULL, action_decision = NULL, "
            "revision = revision + 1 "
            "WHERE id = ? AND route = ? AND action IS ? AND revision = ?"
        )
        with closing(self._connect()) as connection, connection:
            return connection.execute(query, (serialized, key, route, action, revision)).rowcount == 1
