"""Stateless image-plane correspondence analysis for the optional Modal service.

Input images must already be privacy-redacted JPEG/PNG/WebP data URLs. This
module only decodes them to memory, computes actual ORB descriptors and a
RANSAC homography, and returns measured coordinates. It never writes images,
descriptors, or coordinates to disk.
"""

from __future__ import annotations

import base64
import binascii
import math
from typing import Any

SCHEMA_VERSION = 1
MAX_IMAGE_BYTES = 8_000_000
MAX_PIXELS = 16_000_000
MAX_FEATURES = 2_500
MAX_RETURNED_MATCHES = 256
RATIO_THRESHOLD = 0.78
RANSAC_THRESHOLD_PX = 4.0


class ModalGeometryError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _decode_data_url(value: Any, side: str) -> bytes:
    if not isinstance(value, str) or len(value) > 12_000_000:
        raise ModalGeometryError("invalid_image", f"The {side} redacted image is invalid or too large.")
    prefix, separator, encoded = value.partition(",")
    if not separator or prefix not in (
        "data:image/jpeg;base64", "data:image/png;base64", "data:image/webp;base64"
    ):
        raise ModalGeometryError("invalid_image", f"The {side} input must be a redacted JPEG, PNG, or WebP data URL.")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ModalGeometryError("invalid_image", f"The {side} image encoding is invalid.") from exc
    if not decoded or len(decoded) > MAX_IMAGE_BYTES:
        raise ModalGeometryError("image_too_large", f"The {side} image exceeds the 8 MB processing limit.")
    return decoded


def _decode_image(cv2: Any, np: Any, data: bytes, side: str):
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3:
        raise ModalGeometryError("invalid_image", f"The {side} image could not be decoded.")
    height, width = image.shape[:2]
    if width < 32 or height < 32 or width * height > MAX_PIXELS:
        raise ModalGeometryError("invalid_dimensions", f"The {side} image dimensions are outside the supported range.")
    return image


def _uncertainty(candidate_count: int, inlier_count: int, inlier_ratio: float,
                 median_error: float | None, coverage: float) -> dict[str, Any]:
    reasons: list[str] = []
    if candidate_count < 4:
        reasons.append("fewer_than_four_geometric_candidates")
    if inlier_count < 8:
        reasons.append("few_verified_inliers")
    if candidate_count and inlier_ratio < 0.25:
        reasons.append("low_inlier_fraction")
    if coverage < 0.04:
        reasons.append("matches_cover_a_small_image_area")
    if median_error is not None and median_error > 3.0:
        reasons.append("high_median_reprojection_error")
    if inlier_count < 4:
        status = "inconclusive"
    elif reasons:
        status = "caution"
    else:
        status = "measurable"
    return {"status": status, "reasons": reasons}


def analyze_redacted_pair(source_data_url: str, suspect_data_url: str) -> dict[str, Any]:
    """Extract real local features and estimate a 2D homography, in memory."""
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise ModalGeometryError("service_unavailable", "The geometric feature engine is unavailable.") from exc

    source_bytes = _decode_data_url(source_data_url, "original")
    suspect_bytes = _decode_data_url(suspect_data_url, "compared")
    source = _decode_image(cv2, np, source_bytes, "original")
    suspect = _decode_image(cv2, np, suspect_bytes, "compared")
    source_height, source_width = source.shape[:2]
    suspect_height, suspect_width = suspect.shape[:2]

    source_gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    suspect_gray = cv2.cvtColor(suspect, cv2.COLOR_BGR2GRAY)
    detector = cv2.ORB_create(nfeatures=MAX_FEATURES, edgeThreshold=19, patchSize=31, fastThreshold=12)
    source_points, source_descriptors = detector.detectAndCompute(source_gray, None)
    suspect_points, suspect_descriptors = detector.detectAndCompute(suspect_gray, None)
    source_count = len(source_points or ())
    suspect_count = len(suspect_points or ())
    candidates: list[tuple[Any, Any, float]] = []

    if source_descriptors is not None and suspect_descriptors is not None:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        forward = matcher.knnMatch(source_descriptors, suspect_descriptors, k=2)
        reverse = matcher.knnMatch(suspect_descriptors, source_descriptors, k=2)
        reverse_best: dict[int, int] = {}
        for pair in reverse:
            if len(pair) == 2 and pair[0].distance < RATIO_THRESHOLD * pair[1].distance:
                reverse_best[pair[0].queryIdx] = pair[0].trainIdx
        proposed = []
        for pair in forward:
            if len(pair) != 2:
                continue
            best, second = pair
            if best.distance >= RATIO_THRESHOLD * second.distance:
                continue
            if reverse_best.get(best.trainIdx) != best.queryIdx:
                continue
            proposed.append(best)
        proposed.sort(key=lambda match: (match.distance, match.queryIdx, match.trainIdx))
        used_source: set[int] = set()
        used_suspect: set[int] = set()
        for match in proposed:
            if match.queryIdx in used_source or match.trainIdx in used_suspect:
                continue
            used_source.add(match.queryIdx)
            used_suspect.add(match.trainIdx)
            candidates.append((source_points[match.queryIdx], suspect_points[match.trainIdx], float(match.distance)))

    candidate_count = len(candidates)
    matrix = None
    statuses = [False] * candidate_count
    errors: list[float | None] = [None] * candidate_count
    coverage = 0.0
    if candidate_count >= 4:
        source_xy = np.float32([item[0].pt for item in candidates]).reshape(-1, 1, 2)
        suspect_xy = np.float32([item[1].pt for item in candidates]).reshape(-1, 1, 2)
        cv2.setRNGSeed(0)
        homography, inlier_mask = cv2.findHomography(
            source_xy, suspect_xy, cv2.RANSAC, RANSAC_THRESHOLD_PX,
            maxIters=3000, confidence=0.995,
        )
        if homography is not None and inlier_mask is not None and np.isfinite(homography).all():
            projected = cv2.perspectiveTransform(source_xy, homography).reshape(-1, 2)
            actual = suspect_xy.reshape(-1, 2)
            pixel_errors = np.linalg.norm(projected - actual, axis=1)
            statuses = [bool(value) for value in inlier_mask.reshape(-1)]
            errors = [float(value) if math.isfinite(float(value)) else None for value in pixel_errors]
            matrix = [float(value) for value in homography.reshape(-1)]
            inlier_source = source_xy.reshape(-1, 2)[np.asarray(statuses, dtype=bool)]
            if len(inlier_source) >= 3:
                hull = cv2.convexHull(inlier_source.astype(np.float32))
                coverage = min(1.0, float(cv2.contourArea(hull)) / (source_width * source_height))

    inlier_indices = [index for index, value in enumerate(statuses) if value]
    inlier_count = len(inlier_indices)
    inlier_errors = [errors[index] for index in inlier_indices if errors[index] is not None]
    mean_error = float(np.mean(inlier_errors)) if inlier_errors else None
    median_error = float(np.median(inlier_errors)) if inlier_errors else None
    inlier_ratio = inlier_count / candidate_count if candidate_count else 0.0

    result_matches = []
    for index, (left, right, descriptor_distance) in enumerate(candidates[:MAX_RETURNED_MATCHES]):
        result_matches.append({
            "source": {"x": float(left.pt[0] / source_width), "y": float(left.pt[1] / source_height)},
            "suspect": {"x": float(right.pt[0] / suspect_width), "y": float(right.pt[1] / suspect_height)},
            "inlier": statuses[index],
            "reprojection_error_px": errors[index],
            "descriptor_distance": descriptor_distance,
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "provider": "modal",
        "method": "ORB descriptors, mutual ratio-tested Hamming matches, and deterministic RANSAC homography",
        "image_dimensions": {
            "source": {"width": source_width, "height": source_height},
            "suspect": {"width": suspect_width, "height": suspect_height},
        },
        "source_features": source_count,
        "suspect_features": suspect_count,
        "candidate_matches": candidate_count,
        "verified_inliers": inlier_count,
        "rejected_matches": candidate_count - inlier_count,
        "inlier_fraction": inlier_ratio,
        "alignment": {
            "model": "homography" if matrix is not None else "none",
            "coordinate_space": "pixel coordinates in the respective redacted analysis images",
            "matrix_source_to_suspect": matrix,
            "ransac_threshold_px": RANSAC_THRESHOLD_PX,
            "mean_inlier_reprojection_error_px": mean_error,
            "median_inlier_reprojection_error_px": median_error,
            "source_inlier_hull_coverage": coverage,
        },
        "uncertainty": _uncertainty(candidate_count, inlier_count, inlier_ratio, median_error, coverage),
        "matches": result_matches,
        "extensions": {"scene_graph": {"provider": "muse_wonder", "status": "not_configured"}},
        "limitations": [
            "A 2D homography describes an image-plane mapping, not 3D room geometry.",
            "Correspondence does not prove authenticity, authorship, identity, consent, ownership, or wrongdoing.",
            "Only returned top-ranked matches are listed; aggregate counts are computed over all unique candidates.",
            "The masked images may still reveal information in unmasked regions.",
        ],
    }


def analyze_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("consent") is not True:
        raise ModalGeometryError("consent_required", "Explicit consent is required for remote geometric verification.")
    if payload.get("privacy_masked") != {"source": True, "suspect": True}:
        raise ModalGeometryError("privacy_review_required", "Both images must be confirmed as privacy-reviewed masked copies.")
    images = payload.get("images")
    if not isinstance(images, dict):
        raise ModalGeometryError("invalid_request", "Expected two privacy-masked image data URLs.")
    return analyze_redacted_pair(images.get("source"), images.get("suspect"))

