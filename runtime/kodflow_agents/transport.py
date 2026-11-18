"""Bounded HTTPS requests with no redirects, credential logging or implicit retries."""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Iterator, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .ports import Json, ProviderError

MAX_RESPONSE_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class Reply:
    body: Json
    headers: Mapping[str, str]


def credential(variable: str) -> str:
    value = os.environ.get(variable, "")
    if not value or value.strip() != value or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise ProviderError(f"missing or invalid credential in {variable}")
    return value


def https_origin(url: str) -> tuple[str, int]:
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise ProviderError("invalid provider endpoint") from None
    if (
        parts.scheme != "https" or not parts.hostname or parts.username is not None
        or parts.password is not None or parts.fragment
    ):
        raise ProviderError("provider endpoint must be an HTTPS URL without user info or a fragment")
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


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Transport:
    def __init__(self) -> None:
        self.opener = build_opener(NoRedirect())

    def _open(self, method: str, url: str, payload: Json | None, headers: Mapping[str, str], timeout: float):
        https_origin(url)
        body = json.dumps(payload, allow_nan=False).encode() if payload is not None else None
        request = Request(
            url, data=body, method=method,
            headers={"Content-Type": "application/json", "Accept": "application/json", **headers},
        )
        try:
            return self.opener.open(request, timeout=timeout)
        except HTTPError as error:
            error.close()
            raise ProviderError(f"provider returned HTTP {error.code}") from None
        except (URLError, OSError, ValueError):
            raise ProviderError("provider connection failed") from None

    def request(
        self, method: str, url: str, payload: Json | None = None, *,
        headers: Mapping[str, str] | None = None, timeout: float, allow_empty: bool = False,
    ) -> Reply:
        with self._open(method, url, payload, headers or {}, timeout) as response:
            response_headers = {key.lower(): value for key, value in response.headers.items()}
            if response.headers.get_content_type() == "text/event-stream":
                for message in self._sse(response, time.monotonic() + timeout):
                    if "id" in message:
                        return Reply(message, response_headers)
                raise ProviderError("provider stream ended before its JSON-RPC response")
            try:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            except OSError:
                raise ProviderError("provider response could not be read") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ProviderError("provider response exceeded its byte limit")
        return Reply({} if not raw and allow_empty else self._object(raw), response_headers)

    def stream(
        self, url: str, payload: Json, *, headers: Mapping[str, str], timeout: float,
    ) -> Iterator[Json]:
        expires = time.monotonic() + timeout
        with self._open("POST", url, payload, {**headers, "Accept": "text/event-stream"}, timeout) as response:
            if response.headers.get_content_type() != "text/event-stream":
                raise ProviderError("provider did not return an event stream")
            yield from self._sse(response, expires)

    @staticmethod
    def _sse(response, expires: float) -> Iterator[Json]:
        data: list[bytes] = []
        remaining = MAX_RESPONSE_BYTES
        try:
            while time.monotonic() < expires:
                line = response.readline(remaining + 1)
                remaining -= len(line)
                if remaining < 0:
                    raise ProviderError("provider stream exceeded its byte limit")
                if not line:
                    break
                if line in (b"\n", b"\r\n"):
                    if data:
                        yield Transport._object(b"\n".join(data))
                        data = []
                elif line.startswith(b"data:"):
                    data.append(line[5:].lstrip(b" ").rstrip(b"\r\n"))
            else:
                raise ProviderError("provider stream timed out")
            if data:
                yield Transport._object(b"\n".join(data))
        except OSError:
            raise ProviderError("provider event stream could not be read") from None

    @staticmethod
    def _object(raw: bytes) -> Json:
        try:
            value = json.loads(raw)
        except (UnicodeError, ValueError):
            raise ProviderError("provider returned invalid JSON") from None
        if not isinstance(value, dict):
            raise ProviderError("provider returned a non-object JSON response")
        return value
