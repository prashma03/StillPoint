"""TinEye public-index adapter. No arbitrary URL fetching or image persistence.

Wire contract: https://github.com/TinEye/pytineye/blob/main/pytineye/api.py
Paid TinEye API access is required; Meta credentials cannot enable this service.
"""
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request

MAX_RESPONSE = 2_000_000


class DiscoveryError(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code, self.status = code, status


def status():
    return {"provider": "TinEye", "configured": bool(os.environ.get("TINEYE_API_KEY", "").strip()),
            "upload_supported": True, "sources": "TinEye's indexed public web images; not all websites",
            "missing": [] if os.environ.get("TINEYE_API_KEY", "").strip() else ["TINEYE_API_KEY"],
            "thumbnails_enabled": False}


def public_url(value):
    """Sanitize outbound links only. These URLs are NEVER fetched by the backend."""
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 33 for c in value):
        return None
    try:
        url = urllib.parse.urlsplit(value)
        if url.scheme not in ("https", "http") or not url.hostname or url.username or url.password:
            return None
        import ipaddress
        host = url.hostname.lower().rstrip('.')
        if host == "localhost" or '.' not in host or host.endswith((".localhost", ".local", ".internal")):
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            pass
        if url.port not in (None, 80, 443):
            return None
        return value
    except ValueError:
        return None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def normalize(body):
    if not isinstance(body, dict) or body.get("code") != 200:
        raise DiscoveryError("provider_rejected", "TinEye rejected the search. Check API access and search credits.")
    results = body.get("results")
    if not isinstance(results, dict) or not isinstance(results.get("matches"), list):
        raise DiscoveryError("invalid_provider_response", "TinEye returned an invalid response.")
    candidates = []
    for match in results["matches"][:30]:
        if not isinstance(match, dict):
            continue
        links = []
        backlinks = match.get("backlinks")
        for link in (backlinks if isinstance(backlinks, list) else [])[:10]:
            if isinstance(link, dict):
                page, image = public_url(link.get("backlink")), public_url(link.get("url"))
                if page or image:
                    links.append({"page": page, "image": image,
                                  "crawl_date": str(link.get("crawl_date", ""))[:40]})
        image = public_url(match.get("image_url"))
        if not links and not image:
            continue
        # Provider relevance is deliberately not converted into a verification score.
        score = match.get("score")
        candidates.append({"id": str(len(candidates)), "image": image, "links": links,
                           "domain": str(match.get("domain", ""))[:200],
                           "provider_score": score if type(score) in (int, float) and 0 <= score <= 100 else None,
                           "verification": "unverified"})
    return {"provider": "TinEye", "candidates": candidates}


def search(raw, mime):
    key = os.environ.get("TINEYE_API_KEY", "").strip()
    if not key:
        raise DiscoveryError("provider_not_configured", "Set TINEYE_API_KEY on the backend and provision paid TinEye API searches.", 503)
    boundary = secrets.token_hex(24)
    fields = []
    for name, value in (("limit", "30"), ("sort", "score"), ("order", "desc")):
        fields.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    fields.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image_upload"; filename="original"\r\nContent-Type: {mime}\r\n\r\n'.encode() + raw + b'\r\n')
    fields.append(f'--{boundary}--\r\n'.encode())
    request = urllib.request.Request("https://api.tineye.com/rest/search/", data=b''.join(fields),
                                     headers={"x-api-key": key, "Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            if response.headers.get_content_type() != "application/json":
                raise DiscoveryError("invalid_provider_response", "TinEye did not return JSON.")
            payload = response.read(MAX_RESPONSE + 1)
            if len(payload) > MAX_RESPONSE:
                raise DiscoveryError("provider_response_too_large", "TinEye response exceeded the size limit.")
            return normalize(json.loads(payload))
    except urllib.error.HTTPError as exc:
        raise DiscoveryError("provider_http_error", f"TinEye returned HTTP {exc.code}. Check API access, credits, or retry later.") from None
    except (OSError, ValueError, urllib.error.URLError):
        raise DiscoveryError("provider_unavailable", "TinEye timed out or returned an unreadable response. No results were substituted.") from None
