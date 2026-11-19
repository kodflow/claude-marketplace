"""Bounded HTTPS requests without redirects, credential logging or implicit retries."""

from __future__ import annotations

import http.client
import json
import os
from queue import Empty, Queue
import socket
from threading import Lock, Thread, Timer
import time
from dataclasses import dataclass
from typing import Iterable, Iterator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener

from .ports import Json, NoSendError, ProviderError

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
_READ_BYTES = 64 * 1024


@dataclass(frozen=True)
class Reply:
    body: Json
    headers: Mapping[str, str]


class ProviderHTTPError(ProviderError):
    """Status-based recovery is safe only for the protocols that define it."""

    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"provider returned HTTP {status}")


def credential(variable: str) -> str:
    value = os.environ.get(variable, "")
    if not value or value.strip() != value or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise NoSendError(f"missing or invalid credential in {variable}")
    return value


def https_origin(url: str) -> tuple[str, int]:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise NoSendError("invalid provider endpoint") from None
    if (
        parts.scheme != "https" or not parts.hostname or parts.username is not None
        or parts.password is not None or parts.fragment
    ):
        raise NoSendError("provider endpoint must be an HTTPS URL without user info or a fragment")
    return parts.hostname, port if port is not None else 443


def objects(value: object) -> list[Json]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def token_usage(response: Json) -> dict[str, int]:
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return {}
    return {
        name: usage[name]
        for name in ("input_tokens", "output_tokens", "total_tokens")
        if type(usage.get(name)) is int and usage[name] >= 0
    }


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _Deadline:
    """Close a connected socket at the absolute deadline, even inside header parsing."""

    def __init__(self, timeout: float) -> None:
        if timeout <= 0:
            raise NoSendError("provider request deadline expired before send")
        self.expires = time.monotonic() + timeout
        self.lock = Lock()
        self.socket: socket.socket | None = None
        self.watchdog = Timer(timeout, self.interrupt)
        self.watchdog.daemon = True

    def __enter__(self):
        self.watchdog.start()
        return self

    def __exit__(self, *_):
        self.watchdog.cancel()

    def remaining(self) -> float:
        left = self.expires - time.monotonic()
        if left <= 0:
            raise ProviderError("provider request deadline exceeded")
        return left

    def attach(self, connection: socket.socket) -> None:
        with self.lock:
            self.socket = connection
            connection.settimeout(self.remaining())

    def interrupt(self) -> None:
        with self.lock:
            if self.socket is not None:
                try:
                    self.socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def arm_read(self) -> None:
        with self.lock:
            left = self.remaining()
            if self.socket is not None:
                self.socket.settimeout(left)


class _DeadlineHandler(HTTPSHandler):
    def __init__(self, deadline: _Deadline) -> None:
        super().__init__()
        self.deadline = deadline

    def https_open(self, req):
        deadline = self.deadline

        class Connection(http.client.HTTPSConnection):
            def connect(self):
                super().connect()
                try:
                    deadline.attach(self.sock)
                except ProviderError:
                    self.close()
                    raise

        return self.do_open(Connection, req, context=self._context)


class Transport:
    def _open(self, method: str, url: str, payload: Json | None, headers: Mapping[str, str], deadline: _Deadline):
        https_origin(url)
        body = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
        request = Request(
            url, data=body, method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
        )
        opener = build_opener(_NoRedirect(), _DeadlineHandler(deadline))
        mailbox: Queue = Queue()
        handoff = Lock()
        abandoned = False

        def connect() -> None:
            try:
                outcome = opener.open(request, timeout=deadline.remaining())
            except HTTPError as error:
                error.close()
                outcome = ProviderHTTPError(error.code)
            except ProviderError as error:
                outcome = error
            except (URLError, OSError, ValueError, http.client.HTTPException):
                outcome = ProviderError("provider connection failed")
            with handoff:
                # System DNS can outlast a socket timeout. Dispose of a late
                # response in the worker, after the caller has stopped waiting.
                if abandoned:
                    if not isinstance(outcome, ProviderError):
                        outcome.close()
                else:
                    mailbox.put(outcome)

        Thread(target=connect, name="kodflow-provider-connect", daemon=True).start()
        try:
            outcome = mailbox.get(timeout=deadline.remaining())
        except (Empty, ProviderError):
            with handoff:
                abandoned = True
                try:
                    late = mailbox.get_nowait()
                except Empty:
                    late = None
                if late is not None and not isinstance(late, ProviderError):
                    late.close()
            deadline.interrupt()
            raise ProviderError("provider request deadline exceeded") from None
        if isinstance(outcome, ProviderError):
            raise outcome
        return outcome

    @staticmethod
    def _chunks(response, deadline: _Deadline) -> Iterator[bytes]:
        remaining = MAX_RESPONSE_BYTES
        while True:
            try:
                deadline.arm_read()
                data = response.read1(min(remaining + 1, _READ_BYTES))
                deadline.remaining()
            except (OSError, http.client.HTTPException):
                deadline.remaining()
                raise ProviderError("provider response could not be read") from None
            if not data:
                return
            remaining -= len(data)
            if remaining < 0:
                raise ProviderError("provider response exceeded its byte limit")
            yield data

    def request(
        self, method: str, url: str, payload: Json | None = None, *,
        headers: Mapping[str, str] | None = None, timeout: float, allow_empty: bool = False,
    ) -> Reply:
        with _Deadline(timeout) as deadline:
            with self._open(method, url, payload, headers or {}, deadline) as response:
                response_headers = {key.lower(): value for key, value in response.headers.items()}
                chunks = self._chunks(response, deadline)
                if response.headers.get_content_type() == "text/event-stream":
                    expected = payload.get("id") if payload is not None else None
                    for message in self._sse(chunks):
                        if "id" in message and (expected is None or message["id"] == expected):
                            return Reply(message, response_headers)
                    raise ProviderError("provider stream ended before its JSON-RPC response")
                raw = b"".join(chunks)
                return Reply({} if not raw and allow_empty else self._object(raw), response_headers)

    def stream(
        self, url: str, payload: Json, *, headers: Mapping[str, str], timeout: float,
    ) -> Iterator[Json]:
        with _Deadline(timeout) as deadline:
            with self._open("POST", url, payload, {**headers, "Accept": "text/event-stream"}, deadline) as response:
                if response.headers.get_content_type() != "text/event-stream":
                    raise ProviderError("provider did not return an event stream")
                yield from self._sse(self._chunks(response, deadline))

    @staticmethod
    def _sse(chunks: Iterable[bytes]) -> Iterator[Json]:
        buffer = bytearray()
        data: list[bytes] = []
        for chunk in chunks:
            buffer.extend(chunk)
            start = 0
            while (end := buffer.find(b"\n", start)) >= 0:
                line = bytes(buffer[start:end]).rstrip(b"\r")
                start = end + 1
                if line.startswith(b"data:"):
                    data.append(line[5:].lstrip(b" "))
                elif not line and data:
                    yield Transport._object(b"\n".join(data))
                    data.clear()
            del buffer[:start]
        if data or buffer:
            raise ProviderError("provider event stream ended mid-frame")

    @staticmethod
    def _object(raw: bytes) -> Json:
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError):
            raise ProviderError("provider returned invalid JSON") from None
        if not isinstance(value, dict):
            raise ProviderError("provider returned a non-object JSON response")
        return value
