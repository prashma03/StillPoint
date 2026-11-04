"""Pipeline tests: SAM parsing, client errors, HTTP endpoints.

Strict scene-graph validation is covered by eval/test_validate.py.
Run from the repo root: python eval/test_pipeline.py

SAM fixtures below are synthetic strings that follow the documented output
grammar; they are parser test vectors, not model responses.
"""

import base64
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend import meta_client
from backend.meta_client import MetaAPIError
from backend.sam_parse import SegmentationError, coarse_person_rects, parse_boxes
from backend.server import Handler, _with_request_limits


def tiny_png_data_url():
    # Magic-valid PNG header bytes only; enough for transport validation.
    raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


class ScrubKeyMixin:
    def setUp(self):
        self._saved = os.environ.pop("MODEL_API_KEY", None)
        self.addCleanup(self._restore_key)

    def _restore_key(self):
        if self._saved is not None:
            os.environ["MODEL_API_KEY"] = self._saved
        else:
            os.environ.pop("MODEL_API_KEY", None)


class SamParseTests(unittest.TestCase):
    # Synthetic fixtures following the documented <Nf>id<|box|><|mask|> grammar.
    TWO_PEOPLE = (
        "<0f>0<|box;x1=100;y1=100;x2=300;y2=500;w=1000;h=1000|>"
        "<|mask;x=0;y=0;data=10,10,~AAA|>,"
        "1<|box;x1=600;y1=200;x2=800;y2=700;w=1000;h=1000|>"
        "<|mask;x=0;y=0;data=10,10,~BBB|>"
    )

    def test_zero_match_is_empty(self):
        self.assertEqual(parse_boxes(""), [])
        self.assertEqual(parse_boxes("   "), [])
        self.assertEqual(coarse_person_rects(""), [])

    def test_boxes_expand_and_clamp(self):
        rects = coarse_person_rects(self.TWO_PEOPLE)
        self.assertEqual(len(rects), 2)
        first = rects[0]
        # 200x400 box on a 1000px frame, expanded 12% each side.
        self.assertEqual(first, {"x": 76, "y": 52, "width": 248, "height": 496})
        for rect in rects:
            for key in ("x", "y", "width", "height"):
                self.assertGreaterEqual(rect[key], 0)
            self.assertLessEqual(rect["x"] + rect["width"], 1000)
            self.assertLessEqual(rect["y"] + rect["height"], 1000)

    def test_overlapping_people_merge(self):
        text = (
            "<0f>0<|box;x1=100;y1=100;x2=300;y2=300;w=1000;h=1000|>"
            "<|mask;x=0;y=0;data=1,1,~A|>,"
            "1<|box;x1=250;y1=250;x2=450;y2=450;w=1000;h=1000|>"
            "<|mask;x=0;y=0;data=1,1,~B|>"
        )
        self.assertEqual(len(coarse_person_rects(text)), 1)

    def test_masks_never_survive(self):
        rects = coarse_person_rects(self.TWO_PEOPLE)
        dumped = json.dumps(rects)
        self.assertNotIn("AAA", dumped)
        self.assertNotIn("BBB", dumped)
        self.assertNotIn("mask", dumped)

    def test_garbage_raises(self):
        with self.assertRaises(SegmentationError):
            parse_boxes("the model said hello")
        with self.assertRaises(SegmentationError):
            parse_boxes(None)


class ClientTests(ScrubKeyMixin, unittest.TestCase):
    def test_not_configured_without_key(self):
        self.assertFalse(meta_client.is_configured())
        with self.assertRaises(MetaAPIError) as ctx:
            meta_client.extract_scene_graph("data:image/png;base64,AA", "p", {})
        self.assertEqual(ctx.exception.code, "model_not_configured")
        with self.assertRaises(MetaAPIError) as ctx:
            meta_client.segment_people("data:image/png;base64,AA")
        self.assertEqual(ctx.exception.code, "model_not_configured")

    def test_configured_flag_follows_env(self):
        os.environ["MODEL_API_KEY"] = "test-flag-only-never-sent"
        self.assertTrue(meta_client.is_configured())

    def test_http_mapping(self):
        self.assertEqual(meta_client._http_code(401)[0], "auth")
        self.assertEqual(meta_client._http_code(429)[0], "rate_limited")
        self.assertEqual(meta_client._http_code(503)[0], "unavailable")
        self.assertEqual(meta_client._http_code(500)[0], "server_error")
        self.assertEqual(meta_client._http_code(400)[0], "bad_request")

    def test_output_text_extraction(self):
        response = {
            "output": [
                {"type": "message",
                 "content": [{"type": "output_text", "text": '{"a":1}'}]}
            ]
        }
        self.assertEqual(meta_client._output_text(response), '{"a":1}')
        with self.assertRaises(MetaAPIError) as ctx:
            meta_client._output_text({"output": []})
        self.assertEqual(ctx.exception.code, "bad_response")
        with self.assertRaises(MetaAPIError) as ctx:
            meta_client._output_text(
                {"output": [{"type": "refusal", "refusal": "no"}]}
            )
        self.assertEqual(ctx.exception.code, "content_blocked")


class ServerTests(ScrubKeyMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, daemon=True
        )
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def _url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def _request(self, method, path, payload=None):
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self._url(path), data=data, method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_status_reports_unconfigured(self):
        status, body = self._request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertFalse(body["configured"])
        self.assertNotIn("key", json.dumps(body).lower())

    def test_compare_still_refuses_images(self):
        status, body = self._request(
            "POST", "/api/compare", {"image": "data:image/png;base64,AA"}
        )
        self.assertEqual(status, 400)

    def test_analyze_requires_consent(self):
        status, body = self._request(
            "POST", "/api/analyze",
            {"image": tiny_png_data_url(), "consent": False},
        )
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "consent_required")

    def test_analyze_rejects_bad_image(self):
        status, body = self._request(
            "POST", "/api/analyze",
            {"image": "data:image/png;base64,!!!", "consent": True},
        )
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_image")

    def test_analyze_rejects_bad_mask(self):
        status, body = self._request(
            "POST", "/api/analyze",
            {"image": tiny_png_data_url(), "consent": True,
             "mask": {"x": 0, "y": 0, "w": 2, "h": 1}},
        )
        self.assertEqual(status, 400)

    def test_analyze_without_key_is_explicit(self):
        status, body = self._request(
            "POST", "/api/analyze",
            {"image": tiny_png_data_url(), "consent": True,
             "mask": {"x": 0.3, "y": 0.1, "w": 0.3, "h": 0.7}},
        )
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "model_not_configured")

    def test_unknown_paths_404(self):
        status, _ = self._request("GET", "/api/unknown")
        self.assertEqual(status, 404)
        status, _ = self._request("POST", "/api/unknown", {})
        self.assertEqual(status, 404)


class PromptLimitTests(unittest.TestCase):
    def test_budget_and_mask_bounds_appended(self):
        prompt = _with_request_limits(
            "base", 16, {"x": 0.34, "y": 0.1, "w": 0.32, "h": 0.72}
        )
        self.assertIn("at most 16 landmarks", prompt)
        self.assertIn("x=340..660, y=100..820", prompt)
        self.assertIn("within 20 units", prompt)

    def test_malformed_values_fall_back_safely(self):
        self.assertIn("at most 12 landmarks", _with_request_limits("b", None, None))
        self.assertIn("at most 24 landmarks", _with_request_limits("b", 999, None))
        self.assertIn("at most 4 landmarks", _with_request_limits("b", 0, None))
        self.assertIn("at most 12 landmarks", _with_request_limits("b", "many", None))
        # A bad mask never breaks the prompt; it is simply omitted.
        prompt = _with_request_limits("b", 8, {"x": 0, "y": 0})
        self.assertIn("at most 8 landmarks", prompt)
        self.assertNotIn("blacked-out", prompt)


if __name__ == "__main__":
    unittest.main()
