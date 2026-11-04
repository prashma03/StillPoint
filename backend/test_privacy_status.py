import unittest
from backend.server import public_provider_origin

class PrivacyStatusTests(unittest.TestCase):
    def test_origin_removes_credentials_paths_and_query_secrets(self):
        self.assertEqual(public_provider_origin('https://name:secret@proxy.example:8443/private?api_key=secret#token'), 'https://proxy.example:8443')

    def test_malformed_endpoint_does_not_leak_raw_configuration(self):
        self.assertEqual(public_provider_origin('https://example.com:bad/?key=secret'), 'Configured endpoint')

if __name__ == '__main__':
    unittest.main()
