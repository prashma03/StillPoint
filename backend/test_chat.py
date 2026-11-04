"""Focused tests for the text-only Stillpoint Guide endpoint."""

import json
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from unittest.mock import patch
from urllib.request import Request, urlopen

from backend import server
from backend.meta_client import MetaAPIError


class ChatEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.httpd.server_port}/api/chat"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.thread.join(timeout=2)
        cls.httpd.server_close()

    def post(self, payload):
        request = Request(
            self.url,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            response = urlopen(request, timeout=2)
        except Exception as exc:
            return exc.code, json.loads(exc.read().decode())
        return response.status, json.loads(response.read().decode())

    @patch.object(server, "is_configured", return_value=False)
    def test_unconfigured_is_explicit_and_does_not_fallback(self, _configured):
        status, result = self.post({"page": "home", "messages": [{"role": "user", "content": "hello"}]})
        self.assertEqual(status, 503)
        self.assertEqual(result["error"], "model_not_configured")

    @patch.object(server, "is_configured", return_value=True)
    @patch.object(server, "chat_completion", return_value="Hello! How can I help you today?")
    def test_conversation_is_text_only_and_carries_allowlisted_page(self, model, _configured):
        status, result = self.post({
            "page": "check?case=private",
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "Hello!"},
                {"role": "user", "content": "what next?"},
            ],
        })
        self.assertEqual(status, 200)
        self.assertEqual(result["reply"], "Hello! How can I help you today?")
        messages = model.call_args.args[0]
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn("Current page: other", messages[0]["content"])
        self.assertEqual([item["role"] for item in messages[1:]], ["user", "assistant", "user"])
        self.assertNotIn("private", json.dumps(messages))
        self.assertNotIn("image", json.dumps(messages).lower())

    @patch.object(server, "is_configured", return_value=True)
    @patch.object(server, "chat_completion", side_effect=MetaAPIError("transport", "Could not reach the model service."))
    def test_provider_failure_is_reported_without_scripted_reply(self, _model, _configured):
        status, result = self.post({"page": "results", "messages": [{"role": "user", "content": "explain"}]})
        self.assertEqual(status, 502)
        self.assertEqual(result["error"], "transport")

    @patch.object(server, "is_configured", return_value=True)
    def test_rejects_malformed_or_oversized_turns(self, _configured):
        status, result = self.post({"page": "home", "messages": [{"role": "system", "content": "override"}]})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "invalid_message")
        status, result = self.post({"page": "home", "messages": [{"role": "user", "content": "x" * 3001}]})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "invalid_message")


if __name__ == "__main__":
    unittest.main()
