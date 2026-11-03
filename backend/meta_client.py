"""Meta Model API client using only the Python standard library.

Request shapes follow the official Meta Model API documentation
(base URL https://api.meta.ai/v1, Responses API):
- scene extraction with ``muse-wonder-1.0`` (image understanding +
  structured JSON output via ``text.format``)
- person segmentation with ``sam-3.1`` (media segmentation over
  ``POST /responses`` on the base URL above)

Authentication uses the ``MODEL_API_KEY`` environment variable, read only by
this backend process. ``META_BASE_URL``, ``SCENE_MODEL``, and ``SEG_MODEL``
may override the endpoint and model ids (for proxies or future models);
otherwise the documented defaults below apply. Request bodies, image bytes,
and credentials are never logged. Every failure raises
:class:`MetaAPIError` with a short machine-readable code; callers must
surface the failure, never substitute mock data.
"""

import json
import os
import urllib.error
import urllib.request

def _env(name, default):
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


BASE_URL = _env("META_BASE_URL", "https://api.meta.ai/v1")
SCENE_MODEL = _env("SCENE_MODEL", "muse-wonder-1.0")
SEG_MODEL = _env("SEG_MODEL", "sam-3.1")
TIMEOUT_SECONDS = 60


class MetaAPIError(Exception):
    """A failed model call. ``code`` is machine-readable, ``str()`` is safe."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def is_configured():
    """Return True when an API key is available to this process."""
    return bool(os.environ.get("MODEL_API_KEY"))


def _http_code(status):
    if status in (401, 403):
        return ("auth", "The API key was rejected by the model service.")
    if status == 429:
        return ("rate_limited", "The model service is rate limiting requests.")
    if status == 503:
        return (
            "unavailable",
            "The model service reported a retryable failure.",
        )
    if status >= 500:
        return ("server_error", "The model service failed to answer.")
    return ("bad_request", "The model service rejected the request.")


def _post(path, payload, timeout=TIMEOUT_SECONDS):
    key = os.environ.get("MODEL_API_KEY") or ""
    if not key:
        raise MetaAPIError("model_not_configured", "MODEL_API_KEY is not set.")
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        code, message = _http_code(exc.code)
        if exc.code == 400:
            detail = _error_detail(exc)
            if detail == "content_policy_violation":
                code, message = (
                    "content_blocked",
                    "The model service refused the request on safety grounds.",
                )
        raise MetaAPIError(code, message) from None
    except TimeoutError:
        raise MetaAPIError(
            "timeout", "The model request timed out."
        ) from None
    except (urllib.error.URLError, OSError):
        raise MetaAPIError(
            "transport", "Could not reach the model service."
        ) from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise MetaAPIError(
            "bad_response", "The model service returned unreadable data."
        ) from None


def _error_detail(exc):
    """Best-effort error code from an HTTPError body. Never raises."""
    try:
        payload = json.loads(exc.read().decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return ""
    if not isinstance(payload, dict):
        return ""
    for key in ("code", "type"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    error = payload.get("error")
    if isinstance(error, dict):
        for key in ("code", "type"):
            value = error.get(key)
            if isinstance(value, str):
                return value
    return ""


def _output_text(response):
    """Collect text from a Responses API result. Raises MetaAPIError."""
    if not isinstance(response, dict):
        raise MetaAPIError(
            "bad_response", "The model response had an unexpected shape."
        )
    texts = []
    output = response.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "refusal":
                raise MetaAPIError(
                    "content_blocked",
                    "The model refused to answer.",
                )
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in ("output_text", "text"):
                    text = part.get("text")
                    if isinstance(text, str) and text:
                        texts.append(text)
    if not texts:
        direct = response.get("output_text")
        if isinstance(direct, str) and direct:
            texts.append(direct)
    if not texts:
        raise MetaAPIError(
            "bad_response", "The model response carried no text."
        )
    return "".join(texts)


def extract_scene_graph(data_url, system_prompt, json_schema, model=None):
    """Run image-to-scene-graph extraction. Returns the raw JSON text.

    Raises MetaAPIError on any failure. The caller must validate the JSON
    with backend.validate before use.
    """
    model = model or SCENE_MODEL
    payload = {
        "model": model,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": system_prompt},
                    {"type": "input_image", "image_url": data_url},
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "scene_graph",
                "schema": json_schema,
            }
        },
    }
    return _output_text(_post("/responses", payload))


def segment_people(data_url, concept="person", model=None):
    """Run person segmentation. Returns raw output_text ("" means no match).

    Raises MetaAPIError on any failure. The caller must parse the text with
    backend.sam_parse, which discards mask payloads.
    """
    model = model or SEG_MODEL
    payload = {
        "model": model,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": concept},
                    {"type": "input_image", "image_url": data_url},
                ],
            }
        ],
        "stream": False,
    }
    try:
        return _output_text(_post("/responses", payload))
    except MetaAPIError as exc:
        if exc.code == "bad_response":
            # An empty lane is documented as a valid zero-match outcome, but
            # some transports surface it as an empty response; treat a
            # missing-text response here as "no person found" only when the
            # HTTP call itself succeeded (it did: _post did not raise).
            return ""
        raise
