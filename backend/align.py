"""Stillpoint alignment brain: compare two room scene graphs by layout only.

Verdict strings are part of the product contract:
- "Likely derivative"
- "No link found"
- "Cannot determine"

Person-named objects are dropped before scoring. They are never reference points.
"""

import math

# A center that stays within this many units on a 0–1000 scale counts as aligned.
ALIGN_DISTANCE = 25
# The starter sample uses 4 shared objects. A later model may require more.
MIN_USABLE_FOR_DERIVATIVE = 4
DERIVATIVE_AGREEMENT = 80
NO_LINK_AGREEMENT = 40

# Exact names only. "wardrobe" and "headboard" must not match.
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


def _split_people(graph):
    """Return (kept objects, count of person-named objects removed)."""
    kept = []
    excluded = 0
    for obj in graph.get("room_objects", []):
        name = str(obj.get("name", "")).strip().lower()
        if name in FORBIDDEN_NAMES:
            excluded += 1
            continue
        kept.append(obj)
    return kept, excluded


def _coverage(graph):
    """Return coverage_percent only when the graph actually includes one."""
    if "coverage_percent" not in graph:
        return None
    value = graph.get("coverage_percent")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
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
    list1, excluded1 = _split_people(graph1)
    list2, excluded2 = _split_people(graph2)

    # a) Build name -> object lookups so we can match by name.
    # Duplicate names keep the last object, matching dict assignment order.
    objects1 = {obj["name"]: obj for obj in list1}
    objects2 = {obj["name"]: obj for obj in list2}

    # b) Only objects present in BOTH graphs can be scored.
    common_names = [name for name in objects1 if name in objects2]
    usable_points = len(common_names)

    # c) + d) Compare centers for each common object.
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

    # f) Share of usable objects that aligned (0 when nothing matched).
    if usable_points > 0:
        agreement_percent = aligned_points / usable_points * 100
        mean_residual = round(sum(raw_distances) / usable_points, 2)
    else:
        agreement_percent = 0
        mean_residual = None

    # g) Verdict rules. Only these 3 verdicts are ever allowed.
    if (
        usable_points >= MIN_USABLE_FOR_DERIVATIVE
        and agreement_percent >= DERIVATIVE_AGREEMENT
    ):
        verdict = "Likely derivative"
    elif agreement_percent <= NO_LINK_AGREEMENT:
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
