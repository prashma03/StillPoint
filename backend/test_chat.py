"""Focused tests for the text-only Stillpoint Guide endpoint.

Run from the repository root: python backend/test_chat.py
The model client is always mocked; these tests never touch the network.
"""

import json
import os
import socket
import sys
import unittest
from http.server import ThreadingHTTPServer
from threading import Thread
from unittest.mock import patch
from urllib.request import Request, urlopen

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

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
        # Leak check covers user-supplied content only: the fixed server-side
        # system prompt legitimately uses words like "private" and "image".
        conversation = json.dumps(messages[1:])
        self.assertNotIn("private", conversation)
        self.assertNotIn("image", conversation.lower())

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

    @patch.object(server, "is_configured", return_value=True)
    def test_rejects_credentials_and_requires_a_last_user_turn(self, _configured):
        status, result = self.post(
            {"page": "home", "messages": [{"role": "user", "content": "my password is hunter2"}]}
        )
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "sensitive_content")
        status, result = self.post(
            {"page": "home", "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ]}
        )
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "user_message_required")
        status, result = self.post({"page": "home", "messages": []})
        self.assertEqual(status, 400)
        self.assertEqual(result["error"], "messages_required")

    @patch.object(server, "is_configured", return_value=True)
    @patch.object(server, "chat_completion", return_value="ok")
    def test_non_string_page_falls_back_to_other(self, model, _configured):
        status, _result = self.post({"page": ["home"], "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(status, 200)
        messages = model.call_args.args[0]
        self.assertIn("Current page: other", messages[0]["content"])


class ServerStartupTests(unittest.TestCase):
    @patch.object(server, "ThreadingHTTPServer", side_effect=OSError("busy"))
    @patch.object(server, "_port_in_use", return_value=False)
    def test_bind_conflict_exits_with_guidance(self, _probed, _server):
        with self.assertRaises(SystemExit) as ctx:
            server.build_server(8787)
        self.assertEqual(ctx.exception.code, 1)

    def test_running_server_blocks_second_start(self):
        blocker = socket.socket()
        blocker.bind(("127.0.0.1", 0))
        blocker.listen(1)
        port = blocker.getsockname()[1]
        try:
            with self.assertRaises(SystemExit) as ctx:
                server.build_server(port)
            self.assertEqual(ctx.exception.code, 1)
        finally:
            blocker.close()


class CORSHeaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.thread.join(timeout=2)
        cls.httpd.server_close()

    def _allow_origin(self, method, path, origin):
        request = Request(
            self.base + path,
            headers={"Origin": origin},
            method=method,
        )
        with urlopen(request, timeout=2) as response:
            return response.headers.get("Access-Control-Allow-Origin")

    def test_allows_local_vite_ports(self):
        for origin in (
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5175",
            "http://localhost:4173",
        ):
            self.assertEqual(self._allow_origin("GET", "/api/status", origin), origin)
            self.assertEqual(self._allow_origin("OPTIONS", "/api/chat", origin), origin)

    def test_blocks_other_origins(self):
        for origin in ("https://evil.example", "http://localhost:9999", "http://127.0.0.1:3000"):
            self.assertIsNone(self._allow_origin("GET", "/api/status", origin))
            self.assertIsNone(self._allow_origin("OPTIONS", "/api/chat", origin))


if __name__ == "__main__":
    unittest.main()
