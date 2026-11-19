"""Bounded HTTPS requests without redirects, credential logging or implicit retries."""

from __future__ import annotations

import http.client
import json
import os
from queue import Empty, Queue
import re
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
_ERROR_BYTES = 16 * 1024


@dataclass(frozen=True)
class Reply:
    body: Json
    headers: Mapping[str, str]


class StreamInterrupted(ProviderError):
    """An established event stream disconnected while reading."""


class _ResponseReadError(ProviderError):
    """The provider's response body could not be read before the deadline."""


class ProviderConnectionError(ProviderError):
    """A connection failed after an application request could have been sent."""


class ProviderHTTPError(ProviderError):
    """An HTTP error response received from the provider or its gateway."""

    def __init__(self, status: int, *, error_type: str | None = None, request_id: str | None = None) -> None:
        self.status = status
        self.error_type = error_type
        self.request_id = request_id
        message = f"provider returned HTTP {status}"
        if request_id:
            message += f" ({request_id})"
        super().__init__(message)


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
        self.aborted = False
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
            raise _ResponseReadError("provider request deadline exceeded")
        return left

    def attach(self, connection: socket.socket) -> None:
        with self.lock:
            if self.aborted:
                raise NoSendError("provider connection was interrupted before sending")
            connection.settimeout(self.remaining())
            # Attach before urllib can send any application request. A timeout
            # after this boundary cannot prove whether the provider received it.
            self.socket = connection

    def interrupt(self) -> bool:
        with self.lock:
            self.aborted = True
            if self.socket is None:
                return False
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return True

    def connected(self) -> bool:
        with self.lock:
            return self.socket is not None

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
                try:
                    super().connect()
                    deadline.attach(self.sock)
                except (OSError, http.client.HTTPException, ProviderError):
                    self.close()
                    raise NoSendError("provider HTTPS connection failed before sending") from None

        return self.do_open(Connection, req, context=self._context)


class Transport:
    def _open(self, method: str, url: str, payload: Json | None, headers: Mapping[str, str], deadline: _Deadline):
        https_origin(url)
        try:
            body = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
            request = Request(
                url, data=body, method=method,
                headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
            )
        except (TypeError, ValueError):
            raise NoSendError("provider request could not be encoded before sending") from None
        opener = build_opener(_NoRedirect(), _DeadlineHandler(deadline))
        mailbox: Queue = Queue()
        handoff = Lock()
        abandoned = False

        def connect() -> None:
            try:
                outcome = opener.open(request, timeout=deadline.remaining())
            except HTTPError as error:
                outcome = self._http_error(error, deadline)
            except ProviderError as error:
                outcome = error if deadline.connected() else NoSendError("provider connection failed before sending")
            except (URLError, OSError, ValueError, http.client.HTTPException):
                if deadline.connected():
                    outcome = ProviderConnectionError("provider connection failed after the request may have been sent")
                else:
                    outcome = NoSendError("provider connection failed before sending")
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
            if not deadline.interrupt():
                raise NoSendError("provider connection deadline expired before sending") from None
            raise _ResponseReadError("provider request deadline exceeded") from None
        if isinstance(outcome, ProviderError):
            raise outcome
        return outcome

    @classmethod
    def _http_error(cls, response: HTTPError, deadline: _Deadline) -> ProviderHTTPError:
        error_type = None
        request_id = None
        with response:
            if response.headers is not None:
                identifier = response.headers.get("request-id", "")
                if re.fullmatch(r"req_[A-Za-z0-9_-]{1,124}", identifier):
                    request_id = identifier
                if response.headers.get_content_type() == "application/json":
                    try:
                        body = cls._object(b"".join(cls._chunks(response, deadline, limit=_ERROR_BYTES)))
                    except ProviderError:
                        body = {}
                    error = body.get("error")
                    if body.get("type") == "error" and isinstance(error, dict):
                        if isinstance(error.get("type"), str):
                            error_type = error["type"]
        return ProviderHTTPError(response.code, error_type=error_type, request_id=request_id)

    @staticmethod
    def _chunks(response, deadline: _Deadline, *, limit: int = MAX_RESPONSE_BYTES) -> Iterator[bytes]:
        remaining = limit
        is_closed = getattr(response, "isclosed", None)
        while True:
            # HTTPResponse closes its socket as soon as Content-Length is
            # consumed. Keep the bytes already read without rearming that socket.
            if is_closed is not None and is_closed():
                Transport._require_complete_body(response)
                return
            try:
                deadline.arm_read()
                data = response.read1(min(remaining + 1, _READ_BYTES))
                deadline.remaining()
            except (OSError, http.client.HTTPException):
                deadline.remaining()
                raise _ResponseReadError("provider response could not be read") from None
            if not data:
                Transport._require_complete_body(response)
                return
            remaining -= len(data)
            if remaining < 0:
                raise ProviderError("provider response exceeded its byte limit")
            yield data

    @staticmethod
    def _require_complete_body(response) -> None:
        remaining = getattr(response, "length", None)
        if remaining is not None and remaining > 0:
            raise _ResponseReadError("provider response ended before its declared content length")

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
                try:
                    yield from self._sse(self._chunks(response, deadline))
                except _ResponseReadError as error:
                    raise StreamInterrupted(str(error)) from None

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
            raise StreamInterrupted("provider event stream ended mid-frame")

    @staticmethod
    def _object(raw: bytes) -> Json:
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError):
            raise ProviderError("provider returned invalid JSON") from None
        if not isinstance(value, dict):
            raise ProviderError("provider returned a non-object JSON response")
        return value
