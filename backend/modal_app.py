"""Modal-hosted stateless endpoint for opt-in redacted image geometry.

Deploy from the repository root with ``modal deploy -m backend.modal_app``.
Create a Modal proxy token and configure the matching endpoint URL and token
only in the local backend environment. No image or token is logged or stored.
"""

import modal
import json
from fastapi import Request
from fastapi.responses import JSONResponse

from backend.modal_geometry import ModalGeometryError, analyze_payload

app = modal.App("stillpoint-geometric-verification")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]", "numpy<3", "opencv-python-headless==4.11.0.86")
)


@app.function(image=image, timeout=120, scaledown_window=60)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
async def verify_geometry(request: Request):
    try:
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"error": "invalid_request", "message": "The request length is invalid."}, status_code=400)
        if length <= 0 or length > 20_000_000:
            return JSONResponse({"error": "invalid_request", "message": "The request exceeds the processing limit."}, status_code=413)
        payload = await request.json()
        return analyze_payload(payload)
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid_request", "message": "Expected a JSON verification request."}, status_code=400)
    except ModalGeometryError as exc:
        status = 403 if exc.code in {"consent_required", "privacy_review_required"} else 400
        return JSONResponse({"error": exc.code, "message": str(exc)}, status_code=status)
    except Exception:
        # Do not log request contents, exception representations, or image data.
        return JSONResponse({"error": "verification_failed", "message": "Remote geometric verification could not be completed."}, status_code=500)

