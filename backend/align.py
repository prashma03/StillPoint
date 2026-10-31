"""Stillpoint alignment brain: compare two room scene graphs by layout only."""

import math


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


def compare_graphs(graph1, graph2):
    """Compare a source scene graph against a suspect scene graph.

    graph1 = registered/source scene graph JSON.
    graph2 = suspect scene graph JSON.
    Both look like: {"room_objects": [{"name": "bed", ...}, ...]}.
    Returns a dict with usable_points, aligned_points,
    agreement_percent, and verdict.
    """
    # a) Build name -> object lookups so we can match by name.
    objects1 = {obj["name"]: obj for obj in graph1.get("room_objects", [])}
    objects2 = {obj["name"]: obj for obj in graph2.get("room_objects", [])}

    # b) Only objects present in BOTH graphs can be scored.
    common_names = [name for name in objects1 if name in objects2]
    usable_points = len(common_names)

    # c) + d) Compare centers for each common object.
    aligned_points = 0
    for name in common_names:
        cx1, cy1 = get_center(objects1[name])
        cx2, cy2 = get_center(objects2[name])

        # Euclidean distance between the two centers.
        distance = math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

        # If distance < 25, the object stayed almost in the same place
        # on a 0-1000 scale, so the camera viewpoint likely did not move.
        # Count it as ALIGNED. Otherwise leave it uncounted.
        if distance < 25:
            aligned_points += 1

    # f) Share of usable objects that aligned (0 when nothing matched).
    if usable_points > 0:
        agreement_percent = aligned_points / usable_points * 100
    else:
        agreement_percent = 0

    # g) Verdict rules. Only these 3 verdicts are ever allowed.
    # In the real product we will require 12+ points, but for this
    # starter sample test we use 4 points so the demo works with
    # bed, poster, door, rug.
    if usable_points >= 4 and agreement_percent >= 80:
        verdict = "Likely derivative"
    elif agreement_percent <= 40:
        verdict = "No link found"
    else:
        verdict = "Cannot determine"

    # h) Return exactly these four keys.
    return {
        "usable_points": usable_points,
        "aligned_points": aligned_points,
        "agreement_percent": round(agreement_percent, 1),
        "verdict": verdict,
    }


if __name__ == "__main__":
    # Simple example: same layout shifted by a few pixels should align.
    source = {"room_objects": [{"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300}]}
    suspect = {"room_objects": [{"name": "bed", "x": 105, "y": 452, "width": 378, "height": 298}]}
    print(compare_graphs(source, suspect))
