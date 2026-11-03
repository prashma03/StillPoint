"""Segment endpoint tests. Run from the repo root: python eval/test_segment.py

Covers POST /api/segment: consent gating, image validation, missing-key
behavior, and the success path with the model call stubbed. The stub returns
synthetic strings in the documented SAM grammar; they are parser test
vectors, not model responses. No network call is ever made here.
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
from unittest import mock

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

import backend.server
from backend.meta_client import MetaAPIError
from backend.server import Handler

ONE_PERSON = (
    "<0f>0<|box;x1=100;y1=100;x2=300;y2=500;w=1000;h=1000|>"
    "<|mask;x=0;y=0;data=10,10,~AAA|>"
)


def tiny_png_data_url():
    raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


class SegmentEndpointTests(unittest.TestCase):
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

    def setUp(self):
        self._saved = os.environ.pop("MODEL_API_KEY", None)
        self.addCleanup(self._restore_key)

    def _restore_key(self):
        if self._saved is not None:
            os.environ["MODEL_API_KEY"] = self._saved
        else:
            os.environ.pop("MODEL_API_KEY", None)

    def _post(self, payload):
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/segment",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_requires_consent(self):
        status, body = self._post({"image": tiny_png_data_url()})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"], "consent_required")

    def test_rejects_bad_image(self):
        status, body = self._post({"image": "not-a-data-url", "consent": True})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "invalid_image")

    def test_without_key_is_explicit(self):
        status, body = self._post({"image": tiny_png_data_url(), "consent": True})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "model_not_configured")

    def test_success_returns_rects_only(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(
            backend.server, "segment_people", return_value=ONE_PERSON
        ) as stub:
            status, body = self._post(
                {"image": tiny_png_data_url(), "consent": True}
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(
            body["rects"],
            [{"x": 76, "y": 52, "width": 248, "height": 496}],
        )
        self.assertEqual(body["model"], "sam-3.1")
        stub.assert_called_once()
        self.assertNotIn("AAA", json.dumps(body))
        self.assertNotIn("mask", json.dumps(body).lower())

    def test_empty_match_returns_zero_rects(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(backend.server, "segment_people", return_value="  "):
            status, body = self._post(
                {"image": tiny_png_data_url(), "consent": True}
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 0)
        self.assertEqual(body["rects"], [])

    def test_garbage_output_is_rejected(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(
            backend.server, "segment_people", return_value="the model said hello"
        ):
            status, body = self._post(
                {"image": tiny_png_data_url(), "consent": True}
            )
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "invalid_model_output")

    def test_model_errors_pass_through(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(
            backend.server,
            "segment_people",
            side_effect=MetaAPIError("timeout", "The model request timed out."),
        ):
            status, body = self._post(
                {"image": tiny_png_data_url(), "consent": True}
            )
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "timeout")


if __name__ == "__main__":
    unittest.main()
