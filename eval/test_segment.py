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
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

import backend.meta_client
import backend.server
from backend.meta_client import MetaAPIError
from backend.server import (
    Handler,
    load_dotenv,
    refresh_model_config,
    server_port,
)

ONE_PERSON = (
    "<0f>0<|box;x1=100;y1=100;x2=300;y2=500;w=1000;h=1000|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>"
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

    def test_success_returns_decoded_pixel_masks_and_compatibility_rects(self):
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
        self.assertEqual(len(body["masks"]), 1)
        self.assertEqual(len(body["masks"][0]["data"]), 27 * 60)
        self.assertEqual(set(body["masks"][0]["data"]), {0, 1})

    def test_missing_decoder_is_actionable(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(backend.server, "image_segmentation_format", None):
            status, body = self._post({"image": tiny_png_data_url(), "consent": True})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "segment_decoder_missing")

    def test_corrupt_mask_returns_safe_error_instead_of_dropping_connection(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        with mock.patch.object(backend.server, "segment_people", return_value=ONE_PERSON.replace("~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(", "~AAA")):
            status, body = self._post({"image": tiny_png_data_url(), "consent": True})
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "invalid_model_output")

    def test_keyed_box_field_order_does_not_reject_pixel_masks(self):
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        output = ONE_PERSON.replace("x1=100;y1=100;x2=300;y2=500;w=1000;h=1000", "c=0.9;h=1000;w=1000;y2=500;x2=300;y1=100;x1=100")
        with mock.patch.object(backend.server, "segment_people", return_value=output):
            status, body = self._post({"image": tiny_png_data_url(), "consent": True})
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)

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


class ClientRequestTests(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.get("MODEL_API_KEY")
        os.environ["MODEL_API_KEY"] = "test-key-never-sent"
        self.addCleanup(self._restore_key)

    def _restore_key(self):
        if self._saved is not None:
            os.environ["MODEL_API_KEY"] = self._saved
        else:
            os.environ.pop("MODEL_API_KEY", None)

    def _fake_response(self, payload):
        body = json.dumps(payload).encode("utf-8")
        fake = mock.MagicMock()
        fake.read.return_value = body
        context = mock.MagicMock()
        context.__enter__.return_value = fake
        context.__exit__.return_value = False
        return context

    def _output_text(self, text):
        return {
            "output": [
                {"type": "message",
                 "content": [{"type": "output_text", "text": text}]}
            ]
        }

    def test_requests_hit_single_responses_path(self):
        with mock.patch("urllib.request.urlopen") as stub:
            stub.return_value = self._fake_response(self._output_text('{"room_objects": []}'))
            backend.meta_client.extract_scene_graph("data:image/png;base64,AA", "p", {})
            request = stub.call_args[0][0]
            self.assertEqual(
                request.full_url, backend.meta_client.BASE_URL + "/responses"
            )
            payload = json.loads(request.data.decode("utf-8"))
            self.assertEqual(payload["model"], backend.meta_client.SCENE_MODEL)

    def test_segment_requests_use_seg_model(self):
        with mock.patch("urllib.request.urlopen") as stub:
            stub.return_value = self._fake_response(self._output_text(""))
            # Empty text is a zero-match outcome, surfaced as "".
            result = backend.meta_client.segment_people("data:image/png;base64,AA")
            self.assertEqual(result, "")
            request = stub.call_args[0][0]
            self.assertEqual(
                request.full_url, backend.meta_client.BASE_URL + "/responses"
            )
            payload = json.loads(request.data.decode("utf-8"))
            self.assertEqual(payload["model"], backend.meta_client.SEG_MODEL)


class DotenvTests(unittest.TestCase):
    def setUp(self):
        self._saved = {
            key: os.environ.get(key)
            for key in ("MODEL_API_KEY", "META_BASE_URL", "SCENE_MODEL", "SEG_MODEL")
        }
        for key in self._saved:
            os.environ.pop(key, None)
        self.addCleanup(self._restore)

    def _restore(self):
        for key, value in self._saved.items():
            if value is not None:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)

    def _write(self, text):
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".env", delete=False, encoding="utf-8"
        )
        handle.write(text)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_missing_file_loads_nothing(self):
        self.assertEqual(load_dotenv(os.path.join(tempfile.gettempdir(), "no-such.env")), 0)

    def test_loads_whitelisted_keys_only(self):
        path = self._write(
            "# comment\n"
            "MODEL_API_KEY=dotenv-key\n"
            "SCENE_MODEL=custom-scene\n"
            "EVIL=yes\n"
            "MALFORMED LINE\n"
            "SEG_MODEL=\n"
        )
        self.assertEqual(load_dotenv(path), 2)
        self.assertEqual(os.environ["MODEL_API_KEY"], "dotenv-key")
        self.assertEqual(os.environ["SCENE_MODEL"], "custom-scene")
        self.assertNotIn("EVIL", os.environ)
        self.assertNotIn("SEG_MODEL", os.environ)

    def test_real_environment_wins(self):
        os.environ["MODEL_API_KEY"] = "shell-key"
        path = self._write("MODEL_API_KEY=dotenv-key\n")
        self.assertEqual(load_dotenv(path), 0)
        self.assertEqual(os.environ["MODEL_API_KEY"], "shell-key")


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self._saved_env = {
            key: os.environ.get(key)
            for key in ("META_BASE_URL", "SCENE_MODEL", "SEG_MODEL")
        }
        self._saved_module = (
            backend.meta_client.BASE_URL,
            backend.meta_client.SCENE_MODEL,
            backend.meta_client.SEG_MODEL,
        )
        self._saved_server = (
            backend.server.BASE_URL,
            backend.server.SCENE_MODEL,
            backend.server.SEG_MODEL,
        )
        self.addCleanup(self._restore)

    def _restore(self):
        for key, value in self._saved_env.items():
            if value is not None:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)
        (backend.meta_client.BASE_URL, backend.meta_client.SCENE_MODEL,
         backend.meta_client.SEG_MODEL) = self._saved_module
        (backend.server.BASE_URL, backend.server.SCENE_MODEL,
         backend.server.SEG_MODEL) = self._saved_server

    def test_refresh_applies_overrides(self):
        os.environ["SCENE_MODEL"] = "custom-scene"
        os.environ["META_BASE_URL"] = "https://proxy.local/v1"
        refresh_model_config()
        self.assertEqual(backend.meta_client.SCENE_MODEL, "custom-scene")
        self.assertEqual(backend.meta_client.BASE_URL, "https://proxy.local/v1")
        self.assertEqual(backend.server.SCENE_MODEL, "custom-scene")
        self.assertEqual(backend.server.BASE_URL, "https://proxy.local/v1")

    def test_server_port_defaults_and_overrides(self):
        saved = os.environ.get("STILLPOINT_PORT")

        def restore():
            if saved is not None:
                os.environ["STILLPOINT_PORT"] = saved
            else:
                os.environ.pop("STILLPOINT_PORT", None)

        self.addCleanup(restore)
        os.environ.pop("STILLPOINT_PORT", None)
        self.assertEqual(server_port(), 8787)
        os.environ["STILLPOINT_PORT"] = "9999"
        self.assertEqual(server_port(), 9999)
        for bad in ("nope", "0", "70000", "-1"):
            os.environ["STILLPOINT_PORT"] = bad
            with self.subTest(value=bad):
                self.assertEqual(server_port(), 8787)

    def test_refresh_keeps_defaults_without_env(self):
        for key in ("META_BASE_URL", "SCENE_MODEL", "SEG_MODEL"):
            os.environ.pop(key, None)
        backend.meta_client.BASE_URL = "https://api.meta.ai/v1"
        backend.meta_client.SCENE_MODEL = "muse-wonder-1.0"
        backend.meta_client.SEG_MODEL = "sam-3.1"
        refresh_model_config()
        self.assertEqual(backend.server.SCENE_MODEL, "muse-wonder-1.0")
        self.assertEqual(backend.server.SEG_MODEL, "sam-3.1")


if __name__ == "__main__":
    unittest.main()
