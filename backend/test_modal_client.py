import os
import json
import unittest
from unittest.mock import patch, Mock

from backend import modal_client


class ModalClientTests(unittest.TestCase):
    def test_requires_consent_and_mask_review_before_configuration(self):
        with self.assertRaisesRegex(modal_client.ModalClientError, "consent"):
            modal_client.verify({"consent": False})
        with self.assertRaisesRegex(modal_client.ModalClientError, "privacy reviewed"):
            modal_client.verify({"consent": True, "privacy_masked": {"source": True, "suspect": False}})

    def test_only_accepts_https_endpoint_and_token(self):
        with patch.dict(os.environ, {"MODAL_VERIFY_URL": "http://example.com", "MODAL_PROXY_TOKEN": "wk-id.ws-secret"}):
            self.assertIsNone(modal_client.configuration())
        with patch.dict(os.environ, {"MODAL_VERIFY_URL": "https://example.com/verify", "MODAL_PROXY_TOKEN": "wk-id.ws-secret"}):
            self.assertEqual(modal_client.configuration(), "https://example.com/verify")

    @patch("backend.modal_client.urlopen")
    def test_forwards_only_after_consent_with_proxy_bearer_auth(self, mocked_urlopen):
        response = Mock()
        response.status = 200
        response.__enter__ = lambda value: value
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = json.dumps({"schema_version": 1, "provider": "modal", "matches": []}).encode()
        mocked_urlopen.return_value = response
        payload = {"consent": True, "privacy_masked": {"source": True, "suspect": True}, "images": {"source": "redacted-a", "suspect": "redacted-b"}}
        with patch.dict(os.environ, {"MODAL_VERIFY_URL": "https://example.com/verify", "MODAL_PROXY_TOKEN": "wk-id.ws-secret"}):
            result = modal_client.verify(payload)
        request = mocked_urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer wk-id.ws-secret")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(result["provider"], "modal")


if __name__ == "__main__":
    unittest.main()
