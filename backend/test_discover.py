"""Local HTTP and provider contract tests. All provider results are test fixtures."""
import base64
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from backend import discover
from backend.server import Handler, _analysis_attempts

# Generated, non-sensitive 1x1 PNG fixture; no external submission in tests.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=')


class DiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _analysis_attempts.clear()

    def post(self, body, origin='http://localhost:5173'):
        req = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}/api/discover/search',
                                     data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Origin': origin})
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def body(self):
        return {'image': 'data:image/png;base64,' + base64.b64encode(PNG).decode(), 'consent': True, 'non_sensitive': True}

    def test_consent_and_sensitive_gate(self):
        for key in ('consent', 'non_sensitive'):
            body = self.body(); body[key] = False
            with patch.object(discover, 'search') as call:
                self.assertEqual(self.post(body)[0], 403)
                call.assert_not_called()

    def test_missing_credentials(self):
        with patch.dict(os.environ, {'TINEYE_API_KEY': ''}):
            self.assertFalse(discover.status()['configured'])
            self.assertEqual(self.post(self.body())[0], 503)

    def test_empty_and_failure(self):
        with patch.object(discover, 'search', return_value={'provider': 'TinEye', 'candidates': []}):
            status, result = self.post(self.body())
            self.assertEqual(status, 200); self.assertEqual(result['candidates'], [])
        with patch.object(discover, 'search', side_effect=discover.DiscoveryError('provider_unavailable', 'Timed out')):
            self.assertEqual(self.post(self.body())[0], 502)

    def test_bad_image_type_origin_and_rate_limit(self):
        body = self.body(); body['image'] = body['image'].replace('image/png', 'image/jpeg')
        self.assertEqual(self.post(body)[0], 400)
        self.assertEqual(self.post(self.body(), 'https://untrusted.example')[0], 403)
        with patch.object(discover, 'search', return_value={'candidates': []}):
            for _ in range(11): self.post(self.body())
            self.assertEqual(self.post(self.body())[0], 429)

    def test_url_validation(self):
        for value in ('file:///etc/passwd', 'http://127.0.0.1/a', 'http://[::1]/', 'http://169.254.169.254/', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com:99999/', 'http://localhost/'):
            self.assertIsNone(discover.public_url(value), value)

    def test_normalize(self):
        fixture = {'code': 200, 'results': {'matches': [{'domain': 'example.com', 'score': 84, 'image_url': 'https://example.com/photo.png', 'backlinks': [{'backlink': 'https://example.com/page', 'url': 'https://example.com/photo.png', 'crawl_date': '2026-01-01'}]}]}}
        result = discover.normalize(fixture)
        self.assertEqual(result['candidates'][0]['verification'], 'unverified')
        self.assertEqual(result['candidates'][0]['provider_score'], 84)
        self.assertNotIn('similarity', result['candidates'][0])

    def test_real_upload_wire_contract(self):
        response = io.BytesIO(json.dumps({'code': 200, 'results': {'matches': []}}).encode())
        from email.message import Message
        response.headers = Message(); response.headers['Content-Type'] = 'application/json'
        with patch.dict(os.environ, {'TINEYE_API_KEY': 'test-key'}), patch('urllib.request.OpenerDirector.open', return_value=response) as call:
            self.assertEqual(discover.search(PNG, 'image/png')['candidates'], [])
            request = call.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.tineye.com/rest/search/')
            self.assertIn(b'name="image_upload"', request.data)
            self.assertIn(PNG, request.data)
            self.assertEqual(call.call_args.kwargs['timeout'], 30)


if __name__ == '__main__':
    unittest.main()
