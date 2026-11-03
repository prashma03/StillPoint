"""Deployment smoke test. Run from the repo root: python eval/smoke.py

Boots the real backend server as a subprocess, exercises every endpoint
over real HTTP, then shuts the server down. No model key is needed: the
model-gated endpoints are expected to answer 503 model_not_configured,
which proves the key gate (not the models) works. Exit 0 only when every
check passes.

The server boots on an ephemeral free port (STILLPOINT_PORT), so the smoke
never disturbs a backend already running on the default 8787.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8787"
PYTHON = sys.executable


def free_port():
    """A currently free localhost port for the smoke server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

CHECKS = []


def check(name):
    def wrap(func):
        CHECKS.append((name, func))
        return func

    return wrap


def request(method, path, payload=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except (OSError, ValueError):
            body = {}
        return exc.code, body


def load_sample(name):
    with open(os.path.join(PROJECT_ROOT, "sample_data", name), encoding="utf-8") as fh:
        return json.load(fh)


@check("status reports model ids without leaking credentials")
def status_clean():
    status, body = request("GET", "/api/status")
    assert status == 200, f"status {status}"
    assert body["scene_model"] == "muse-wonder-1.0", body
    assert body["seg_model"] == "sam-3.1", body
    assert "key" not in json.dumps(body).lower(), body


@check("compare links the derivative samples")
def compare_derivative():
    status, body = request(
        "POST", "/api/compare",
        {"source": load_sample("graph1.json"), "suspect": load_sample("graph2.json")},
    )
    assert status == 200, f"status {status}"
    assert body["engine"] == "python", body
    assert body["result"]["verdict"] == "Likely derivative", body


@check("compare refuses image payloads")
def compare_refuses_images():
    status, _ = request("POST", "/api/compare", {"image": "data:image/png;base64,AA"})
    assert status == 400, f"status {status}"


@check("analyze requires consent")
def analyze_consent():
    status, body = request("POST", "/api/analyze", {"image": "x"})
    assert status == 403, f"status {status}"
    assert body.get("error") == "consent_required", body


@check("segment requires consent")
def segment_consent():
    status, body = request("POST", "/api/segment", {"image": "x"})
    assert status == 403, f"status {status}"
    assert body.get("error") == "consent_required", body


@check("unknown paths 404")
def unknown_paths():
    status, _ = request("GET", "/api/nope")
    assert status == 404, f"status {status}"


def wait_for_boot(process, deadline=20):
    start = time.time()
    while time.time() - start < deadline:
        if process.poll() is not None:
            raise RuntimeError("server process exited during boot")
        try:
            with urllib.request.urlopen(BASE + "/api/status", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError("server did not answer /api/status in time")


def main():
    global BASE
    env = dict(os.environ)
    env.pop("MODEL_API_KEY", None)  # smoke must prove the no-key path
    port = free_port()
    env["STILLPOINT_PORT"] = str(port)
    BASE = f"http://127.0.0.1:{port}"
    try:
        process = subprocess.Popen(
            [PYTHON, "-m", "backend.server"],
            cwd=PROJECT_ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as exc:
        print(f"FAIL could not start server: {exc}")
        return 1
    try:
        try:
            wait_for_boot(process)
        except RuntimeError as exc:
            print(f"FAIL {exc} (is port 8787 already occupied?)")
            return 1
        failures = 0
        for name, func in CHECKS:
            try:
                func()
            except (AssertionError, OSError) as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
            else:
                print(f"ok {name}")
        print(f"{len(CHECKS) - failures}/{len(CHECKS)} smoke checks passed")
        return 1 if failures else 0
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
