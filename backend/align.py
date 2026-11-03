"""Stillpoint alignment brain: compare two room scene graphs by layout only.

Verdict strings are part of the product contract:
- "Likely derivative"
- "No link found"
- "Cannot determine"

Person-named objects are dropped before scoring. They are never reference points.

This engine measures background-layout agreement only. It does not prove image
derivation, identity, or consent.
"""

import math

# A center that stays within this many units on a 0–1000 scale counts as aligned.
ALIGN_DISTANCE = 25
# Both a positive and a negative verdict need this many shared background
# objects. Anything less is insufficient evidence ("Cannot determine").
# The starter sample uses 4 shared objects. A later model may require more.
MIN_USABLE_FOR_VERDICT = 4
# Kept for backward compatibility; identical to MIN_USABLE_FOR_VERDICT.
MIN_USABLE_FOR_DERIVATIVE = MIN_USABLE_FOR_VERDICT
DERIVATIVE_AGREEMENT = 80
NO_LINK_AGREEMENT = 40

# Valid range for x, y, width, and height on the 0–1000 scene-graph scale.
COORD_MIN = 0
COORD_MAX = 1000

# Exact names only (after trimming and lowercasing).
# "wardrobe" and "headboard" must not match.
FORBIDDEN_NAMES = {
    "person",
    "face",
    "body",
    "hair",
    "skin",
    "clothes",
    "head",
}


def get_center(obj):
    """Find the center point of one room object.

    Input is one room object with x, y, width, height.
    Center X = x + width / 2 (left edge plus half the width).
    Center Y = y + height / 2 (top edge plus half the height).
    Returns (center_x, center_y) as a tuple.
    """
    center_x = obj["x"] + obj["width"] / 2
    center_y = obj["y"] + obj["height"] / 2
    return (center_x, center_y)


def _normalize_name(value):
    """Return the canonical object name, or None when it is not usable.

    Canonical form is trimmed and lowercased, so "Bed", "bed", and " BED "
    all match. Non-string, empty, and whitespace-only names are invalid.
    """
    if not isinstance(value, str):
        return None
    name = value.strip().lower()
    return name or None


def _is_valid_number(value):
    """Return True for a finite int/float coordinate (bools excluded)."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _is_valid_coords(obj):
    """Return True when x, y, width, height are finite and within range."""
    for key in ("x", "y", "width", "height"):
        value = obj.get(key)
        if not _is_valid_number(value):
            return False
        if value < COORD_MIN or value > COORD_MAX:
            return False
    return True


def _prepare_objects(graph):
    """Validate one graph into an ordered name -> object lookup.

    Returns (objects, excluded_people, invalid, duplicates):
    - objects: dict keyed by normalized name, first occurrence wins.
    - excluded_people: count of person-named objects removed.
    - invalid: count of objects with unusable names or coordinates.
    - duplicates: count of repeated normalized names beyond the first.
    """
    if not isinstance(graph, dict):
        return {}, 0, 0, 0
    items = graph.get("room_objects", [])
    if not isinstance(items, list):
        return {}, 0, 0, 0
    objects = {}
    excluded = 0
    invalid = 0
    duplicates = 0
    for obj in items:
        if not isinstance(obj, dict):
            invalid += 1
            continue
        name = _normalize_name(obj.get("name"))
        if name is None:
            invalid += 1
            continue
        if name in FORBIDDEN_NAMES:
            excluded += 1
            continue
        if not _is_valid_coords(obj):
            invalid += 1
            continue
        if name in objects:
            duplicates += 1
            continue
        objects[name] = obj
    return objects, excluded, invalid, duplicates


def _split_people(graph):
    """Return (kept objects, count of person-named objects removed).

    Kept for backward compatibility. Prefer _prepare_objects, which also
    normalizes names and rejects invalid coordinates and duplicates.
    """
    objects, excluded, _, _ = _prepare_objects(graph)
    return list(objects.values()), excluded


def _coverage(graph):
    """Return coverage_percent only when the graph actually includes one."""
    if not isinstance(graph, dict) or "coverage_percent" not in graph:
        return None
    value = graph.get("coverage_percent")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def compare_graphs(graph1, graph2):
    """Compare a source scene graph against a suspect scene graph.

    graph1 = registered/source scene graph JSON.
    graph2 = suspect scene graph JSON.
    Both look like: {"room_objects": [{"name": "bed", ...}, ...]}.

    The original four fields are unchanged:
    usable_points, aligned_points, agreement_percent, verdict.

    Extra fields describe the same comparison. They are measurements,
    not a confidence score.
    """
    objects1, excluded1, invalid1, duplicates1 = _prepare_objects(graph1)
    objects2, excluded2, invalid2, duplicates2 = _prepare_objects(graph2)

    # Only objects present in BOTH graphs can be scored, in source order.
    common_names = [name for name in objects1 if name in objects2]
    usable_points = len(common_names)

    # Compare centers for each common object.
    aligned_points = 0
    residuals = []
    raw_distances = []
    for name in common_names:
        cx1, cy1 = get_center(objects1[name])
        cx2, cy2 = get_center(objects2[name])

        # Euclidean distance between the two centers.
        distance = math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)
        raw_distances.append(distance)

        # If distance < 25, the object stayed almost in the same place
        # on a 0-1000 scale, so the camera viewpoint likely did not move.
        # Count it as ALIGNED. Otherwise leave it uncounted.
        aligned = distance < ALIGN_DISTANCE
        if aligned:
            aligned_points += 1
        residuals.append(
            {
                "name": name,
                "distance": round(distance, 2),
                "aligned": aligned,
            }
        )

    # Share of usable objects that aligned (0 when nothing matched).
    if usable_points > 0:
        agreement_percent = aligned_points / usable_points * 100
        mean_residual = round(sum(raw_distances) / usable_points, 2)
    else:
        agreement_percent = 0
        mean_residual = None

    # Verdict rules. Only these 3 verdicts are ever allowed.
    # Both directions require enough shared background objects; anything
    # less is insufficient evidence, never a negative verdict.
    if (
        usable_points >= MIN_USABLE_FOR_VERDICT
        and agreement_percent >= DERIVATIVE_AGREEMENT
    ):
        verdict = "Likely derivative"
    elif (
        usable_points >= MIN_USABLE_FOR_VERDICT
        and agreement_percent <= NO_LINK_AGREEMENT
    ):
        verdict = "No link found"
    else:
        verdict = "Cannot determine"

    return {
        "usable_points": usable_points,
        "aligned_points": aligned_points,
        "agreement_percent": round(agreement_percent, 1),
        "verdict": verdict,
        "residuals": residuals,
        "mean_residual": mean_residual,
        "alignment_threshold": ALIGN_DISTANCE,
        "excluded_person_objects": excluded1 + excluded2,
        "invalid_objects": invalid1 + invalid2,
        "duplicate_objects": duplicates1 + duplicates2,
        "source_coverage_percent": _coverage(graph1),
        "suspect_coverage_percent": _coverage(graph2),
    }


if __name__ == "__main__":
    # Simple example: same layout shifted by a few pixels should align.
    source = {
        "room_objects": [
            {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300}
        ]
    }
    suspect = {
        "room_objects": [
            {"name": "bed", "x": 105, "y": 452, "width": 378, "height": 298}
        ]
    }
    print(compare_graphs(source, suspect))
