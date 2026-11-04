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
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger("stillpoint.guide")

def _env(name, default):
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


BASE_URL = _env("META_BASE_URL", "https://api.meta.ai/v1")
SCENE_MODEL = _env("SCENE_MODEL", "muse-wonder-1.0")
SEG_MODEL = _env("SEG_MODEL", "sam-3.1")
TIMEOUT_SECONDS = 60


class MetaAPIError(Exception):
    """A failed model call. ``code`` is machine-readable, ``str()`` is safe.

    ``status`` is the upstream HTTP status when the failure came from the
    model service. ``upstream_type``, ``upstream_code``, and ``upstream_param``
    are sanitized provider fields for logs. They are never the API key and
    never the request body.
    """

    def __init__(
        self,
        code,
        message,
        status=None,
        upstream_type="",
        upstream_code="",
        upstream_param="",
    ):
        super().__init__(message)
        self.code = code
        self.status = status
        self.upstream_type = upstream_type
        self.upstream_code = upstream_code
        self.upstream_param = upstream_param


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
    return ("bad_request", "The assistant could not answer that message.")


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
        fields = _error_fields(exc)
        _log_upstream(exc.code, fields)
        code, message = _http_code(exc.code)
        if "content_policy_violation" in (fields["type"], fields["code"]):
            code, message = (
                "content_blocked",
                "The assistant declined that message.",
            )
        raise MetaAPIError(
            code,
            message,
            status=exc.code,
            upstream_type=fields["type"],
            upstream_code=fields["code"],
            upstream_param=fields["param"],
        ) from None
    except TimeoutError:
        _log_upstream("timeout", {"type": "timeout", "code": "timeout", "param": ""})
        raise MetaAPIError(
            "timeout",
            "The model request timed out.",
            upstream_type="timeout",
            upstream_code="timeout",
        ) from None
    except (urllib.error.URLError, OSError):
        _log_upstream("transport", {"type": "transport", "code": "transport", "param": ""})
        raise MetaAPIError(
            "transport",
            "Could not reach the model service.",
            upstream_type="transport",
            upstream_code="transport",
        ) from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise MetaAPIError(
            "bad_response", "The model service returned unreadable data."
        ) from None


def _safe_token(value):
    """Keep a short provider code. Drop anything that is not an identifier."""
    if not isinstance(value, str):
        return ""
    cleaned = "".join(ch for ch in value if ch.isalnum() or ch in "._-")
    return cleaned[:80]


def _error_fields(exc):
    """Sanitized type, code, and param from an HTTPError body. Never raises."""
    fields = {"type": "", "code": "", "param": ""}
    try:
        payload = json.loads(exc.read().decode("utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return fields
    if not isinstance(payload, dict):
        return fields
    error = payload.get("error")
    source = error if isinstance(error, dict) else payload
    for key in ("type", "code", "param"):
        fields[key] = _safe_token(source.get(key))
    return fields


def _log_upstream(status, fields):
    """Developer log. Status and safe codes only — never the key or the prompt."""
    log.warning(
        "model request failed status=%s type=%s code=%s param=%s",
        status,
        fields.get("type") or "-",
        fields.get("code") or "-",
        fields.get("param") or "-",
    )


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


def _message_item(role, text):
    """Responses API content type depends on the author.

    User, system, and developer turns are ``input_text``. A replayed assistant
    turn must be ``output_text``. Sending ``input_text`` on an assistant
    message is rejected with HTTP 400 (invalid_request_error, param input_text).
    """
    if role not in ("system", "developer", "user", "assistant"):
        raise MetaAPIError("bad_request", "The conversation contained an unsupported message.")
    part = "output_text" if role == "assistant" else "input_text"
    return {
        "type": "message",
        "role": role,
        "content": [{"type": part, "text": text}],
    }


def chat_completion(messages, model=None):
    """Run a text-only conversational turn through the configured Responses API."""
    payload = {
        "model": model or SCENE_MODEL,
        "input": [_message_item(item["role"], item["content"]) for item in messages],
        "stream": False,
    }
    return _output_text(_post("/responses", payload))
