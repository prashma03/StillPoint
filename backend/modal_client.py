"""Authenticated, stateless proxy from the loopback API to Modal."""

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ModalClientError(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code = code
        self.status = status


def configuration():
    endpoint = os.environ.get("MODAL_VERIFY_URL", "").strip()
    token = os.environ.get("MODAL_PROXY_TOKEN", "").strip()
    try:
        parsed = urlsplit(endpoint)
        valid_endpoint = (parsed.scheme == "https" and parsed.hostname and
                          not parsed.username and not parsed.password and
                          not parsed.query and not parsed.fragment)
    except ValueError:
        valid_endpoint = False
    return endpoint if valid_endpoint and re.fullmatch(r"wk-[A-Za-z0-9_-]+\.ws-[A-Za-z0-9_-]+", token) else None


def verify(payload):
    if not isinstance(payload, dict) or payload.get("consent") is not True:
        raise ModalClientError("consent_required", "Explicit remote verification consent is required.", 403)
    if payload.get("privacy_masked") != {"source": True, "suspect": True}:
        raise ModalClientError("privacy_review_required", "Both image copies must be privacy reviewed and masked.", 403)
    endpoint = configuration()
    token = os.environ.get("MODAL_PROXY_TOKEN", "").strip()
    if not endpoint:
        raise ModalClientError("modal_not_configured", "Modal verification is not configured on this computer.", 503)
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    if len(body) > 20_000_000:
        raise ModalClientError("request_too_large", "The redacted image pair exceeds the request limit.", 413)
    request = Request(endpoint, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }, method="POST")
    try:
        with urlopen(request, timeout=130) as response:
            if response.status != 200:
                raise ModalClientError("modal_unavailable", "Modal verification returned an unsuccessful response.")
            result = json.loads(response.read(2_000_001).decode("utf-8"))
    except HTTPError as exc:
        # Do not propagate provider messages that may contain implementation details.
        raise ModalClientError("modal_unavailable", "Modal verification could not complete this request.") from exc
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModalClientError("modal_unavailable", "Modal verification is unavailable; the local result can still be used.") from exc
    if not isinstance(result, dict) or result.get("provider") != "modal" or result.get("schema_version") != 1:
        raise ModalClientError("invalid_modal_response", "Modal returned an unsupported verification result.")
    return result
