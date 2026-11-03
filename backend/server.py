"""Local Stillpoint API.

- ``POST /api/compare`` accepts scene graphs only and refuses image fields.
- ``GET /api/status`` reports whether model analysis is configured.
  The answer is a boolean; credentials are never exposed.
- ``POST /api/analyze`` accepts one redacted photograph (data URL) plus an
  explicit consent flag, and returns a validated background-only scene
  graph. Without consent, without a valid redacted image, or without a
  configured API key it refuses with an explicit error. It never invents
  a graph.
- ``POST /api/segment`` accepts one photograph (data URL) plus an explicit
  consent flag, and returns coarse person rectangles from the segmentation
  model. Pixel masks are discarded: only rectangles leave this process.
  The caller must show the suggestion for human review and correction.

Binds to 127.0.0.1 so requests never leave this computer. Image bytes are
held in memory only and never written to disk or logs.

Run from the repository root:

    python -m backend.server
"""

import base64
import binascii
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.align import compare_graphs
from backend.meta_client import (
    BASE_URL,
    SCENE_MODEL,
    SEG_MODEL,
    MetaAPIError,
    extract_scene_graph,
    is_configured,
    segment_people,
)
from backend.sam_parse import SegmentationError, coarse_person_rects
from backend.validate import validate_graph

HOST = "127.0.0.1"
PORT = 8787
MAX_BYTES = 200_000
ANALYZE_MAX_BYTES = 12_000_000
MAX_IMAGE_BYTES = 8_000_000
ALLOWED_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}
# Model output is untrusted: cap what one analysis may return.
MAX_MODEL_OBJECTS = 60
MAX_MODEL_NAME = 80


class _InvalidModelOutput(Exception):
    """Model output failed the strict validation gate."""
IMAGE_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)

SCENE_SCHEMA = {
    "type": "object",
    "properties": {
        "room_objects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                    "occludes": {"type": "array", "items": {"type": "string"}},
                    "is_above": {"type": "array", "items": {"type": "string"}},
                    "is_below": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "x", "y", "width", "height"],
                "additionalProperties": False,
            },
        },
        "total_stable_points": {"type": "number"},
        "coverage_percent": {"type": "number"},
    },
    "required": ["room_objects"],
    "additionalProperties": False,
}


def _load_prompt():
    path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "prompts",
        "scene_graph.txt",
    )
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _decode_image(data_url):
    """Return (raw bytes, mime) or raise ValueError. Checks type and magic."""
    if not isinstance(data_url, str):
        raise ValueError("Image must be a data URL string.")
    for prefix in IMAGE_PREFIXES:
        if data_url.startswith(prefix):
            encoded = data_url[len(prefix):]
            mime = prefix[len("data:"):-len(";base64,")]
            break
    else:
        raise ValueError("Only JPEG, PNG, or WebP data URLs are accepted.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("Image data is not valid base64.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("Image is larger than 8 MB.")
    if raw[:3] == b"\xff\xd8\xff":
        return raw, mime
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, mime
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, mime
    raise ValueError("Image bytes are not a supported format.")


def _valid_mask(mask):
    if mask is None:
        return False
    if not isinstance(mask, dict):
        raise ValueError("Mask must be an object.")
    for key in ("x", "y", "w", "h"):
        value = mask.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Mask needs numeric x, y, w, and h.")
        if value < 0 or value > 1:
            raise ValueError("Mask values must be fractions from 0 to 1.")
    return True


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path != "/api/status":
            self._send(404, {"error": "Not found"})
            return
        self._send(
            200,
            {
                "configured": is_configured(),
                "base_url": BASE_URL,
                "scene_model": SCENE_MODEL,
                "seg_model": SEG_MODEL,
                "max_image_bytes": MAX_IMAGE_BYTES,
            },
        )

    def _read_json(self, limit):
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > limit:
            return None
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
        if not isinstance(body, dict):
            return False
        return body

    def do_POST(self):
        if self.path == "/api/compare":
            self._handle_compare()
        elif self.path == "/api/analyze":
            self._handle_analyze()
        elif self.path == "/api/segment":
            self._handle_segment()
        else:
            self._send(404, {"error": "Not found"})

    def _handle_compare(self):
        body = self._read_json(MAX_BYTES)
        if body is None:
            self._send(413, {"error": "Scene graph payload is empty or too large."})
            return
        if body is False:
            self._send(400, {"error": "Expected JSON scene graphs."})
            return
        # Photographs are never an input to this endpoint.
        for key in ("image", "photo", "dataUrl", "data_url", "pixels", "blob"):
            if key in body:
                self._send(400, {"error": "Images are not accepted."})
                return
        source = body.get("source")
        suspect = body.get("suspect")
        if not isinstance(source, dict) or not isinstance(suspect, dict):
            self._send(400, {"error": "source and suspect scene graphs are required."})
            return
        try:
            result = compare_graphs(source, suspect)
        except (KeyError, TypeError, ValueError) as exc:
            self._send(400, {"error": f"Could not compare those graphs: {exc}"})
            return
        self._send(200, {"engine": "python", "result": result})

    def _handle_analyze(self):
        body = self._read_json(ANALYZE_MAX_BYTES)
        if body is None:
            self._send(413, {"error": "Image payload is empty or too large."})
            return
        if body is False:
            self._send(400, {"error": "Expected a JSON object."})
            return
        if body.get("consent") is not True:
            self._send(
                403,
                {"error": "consent_required",
                 "message": "Explicit consent is required for image analysis."},
            )
            return
        try:
            raw_image, mime = _decode_image(body.get("image"))
            mask_applied = _valid_mask(body.get("mask"))
        except ValueError as exc:
            self._send(400, {"error": "invalid_image", "message": str(exc)})
            return
        if not is_configured():
            self._send(
                503,
                {"error": "model_not_configured",
                 "message": "No model API key is configured on this computer."},
            )
            return
        try:
            prompt = _load_prompt()
        except OSError:
            self._send(
                500,
                {"error": "prompt_missing",
                 "message": "The scene-graph prompt is not installed."},
            )
            return
        try:
            # Re-encode from validated bytes so only a supported image is sent.
            data_url = (
                f"data:{mime};base64,"
                + base64.b64encode(raw_image).decode("ascii")
            )
            text = extract_scene_graph(data_url, prompt, SCENE_SCHEMA)
            checked = validate_graph(json.loads(text))
            if not checked["ok"]:
                problems = checked["errors"]
                detail = problems[0]["message"] if problems else "unusable scene graph"
                raise _InvalidModelOutput(detail)
            graph = checked["graph"]
            if len(graph["room_objects"]) > MAX_MODEL_OBJECTS or any(
                len(obj["name"]) > MAX_MODEL_NAME for obj in graph["room_objects"]
            ):
                raise _InvalidModelOutput("too many objects or names too long")
            gate = checked["report"]
            report = {
                "object_count": gate["object_count"],
                "excluded_people": gate["excluded_people"],
                "warnings": checked["warnings"],
            }
        except MetaAPIError as exc:
            self._send(502, {"error": exc.code, "message": str(exc)})
            return
        except (json.JSONDecodeError, _InvalidModelOutput) as exc:
            self._send(
                502,
                {"error": "invalid_model_output",
                 "message": f"The model output was not a usable scene graph: {exc}"},
            )
            return
        report["model"] = SCENE_MODEL
        report["mask_applied"] = mask_applied
        self._send(200, {"graph": graph, "report": report, "model": SCENE_MODEL})

    def _handle_segment(self):
        body = self._read_json(ANALYZE_MAX_BYTES)
        if body is None:
            self._send(413, {"error": "Image payload is empty or too large."})
            return
        if body is False:
            self._send(400, {"error": "Expected a JSON object."})
            return
        if body.get("consent") is not True:
            self._send(
                403,
                {"error": "consent_required",
                 "message": "Explicit consent is required for person detection."},
            )
            return
        try:
            raw_image, mime = _decode_image(body.get("image"))
        except ValueError as exc:
            self._send(400, {"error": "invalid_image", "message": str(exc)})
            return
        if not is_configured():
            self._send(
                503,
                {"error": "model_not_configured",
                 "message": "No model API key is configured on this computer."},
            )
            return
        try:
            data_url = (
                f"data:{mime};base64,"
                + base64.b64encode(raw_image).decode("ascii")
            )
            text = segment_people(data_url)
            rects = coarse_person_rects(text)
        except MetaAPIError as exc:
            self._send(502, {"error": exc.code, "message": str(exc)})
            return
        except SegmentationError as exc:
            self._send(
                502,
                {"error": "invalid_model_output",
                 "message": f"The segmentation output was not usable: {exc}"},
            )
            return
        self._send(
            200,
            {"rects": rects, "count": len(rects), "model": SEG_MODEL},
        )

    def log_message(self, fmt, *args):
        # Do not write request bodies. The default logger only prints the path.
        super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Stillpoint alignment listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
