"""Local alignment API.

Accepts scene graphs only. Refuses image payloads.
Binds to 127.0.0.1 so graphs are not exposed on the network.

Run from the repository root:

    python -m backend.server
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.align import compare_graphs

HOST = "127.0.0.1"
PORT = 8787
MAX_BYTES = 200_000
ALLOWED_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/compare":
            self._send(404, {"error": "Not found"})
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0 or length > MAX_BYTES:
            self._send(413, {"error": "Scene graph payload is empty or too large."})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send(400, {"error": "Expected JSON scene graphs."})
            return
        if not isinstance(body, dict):
            self._send(400, {"error": "Expected a JSON object."})
            return
        # Photographs are never an input to this service.
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

    def log_message(self, fmt, *args):
        # Do not write request bodies. The default logger only prints the path.
        super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Stillpoint alignment listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
