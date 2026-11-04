import base64
import unittest

from backend.modal_geometry import ModalGeometryError, analyze_payload, _decode_data_url


class ModalGeometryTests(unittest.TestCase):
    def test_requires_explicit_consent_and_both_privacy_reviews(self):
        with self.assertRaisesRegex(ModalGeometryError, "Explicit consent"):
            analyze_payload({"consent": False})
        with self.assertRaisesRegex(ModalGeometryError, "Both images"):
            analyze_payload({"consent": True, "privacy_masked": {"source": True, "suspect": False}})

    def test_rejects_invalid_mime_and_encoded_data(self):
        for value in ("data:image/gif;base64,AAAA", "data:image/jpeg;base64,***"):
            with self.subTest(value=value), self.assertRaises(ModalGeometryError):
                _decode_data_url(value, "test")

    def test_accepts_small_encoded_payload_for_image_decoder(self):
        data = b"\xff\xd8\xff" + b"test"
        decoded = _decode_data_url("data:image/jpeg;base64," + base64.b64encode(data).decode(), "test")
        self.assertEqual(decoded, data)


if __name__ == "__main__":
    unittest.main()
