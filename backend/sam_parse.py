"""Parse SAM 3.1 segmentation output into coarse person rectangles.

Wire grammar (official Media segmentation / SAM documentation): the result
arrives as special-token text with one line per frame::

    <Nf>id<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|><|mask;...|>,...

Only box tokens are read. Mask payloads are never decoded, stored, logged,
or returned. Boxes are expanded by a margin and merged into coarse
rectangles on the 0-1000 scene-graph scale.
"""

import re

# Box corners are source pixels; w/h repeat the source frame size.
_BOX_RE = re.compile(
    r"<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=[^|]*)?\|>"
)

# Each side grows by this fraction of the box dimension (min 8 units).
EXPAND_FRACTION = 0.12
MIN_EXPAND_UNITS = 8


class SegmentationError(Exception):
    """The segmentation output could not be parsed."""


def parse_boxes(output_text):
    """Return [(x1, y1, x2, y2, w, h)] in source pixels.

    Empty/whitespace text is a valid zero-match outcome and yields [].
    Non-empty text without any box token raises SegmentationError.
    """
    if not isinstance(output_text, str):
        raise SegmentationError("Segmentation output must be text.")
    if not output_text.strip():
        return []
    boxes = [
        tuple(int(value) for value in match)
        for match in _BOX_RE.findall(output_text)
    ]
    if not boxes:
        raise SegmentationError("No person boxes were found in the output.")
    return boxes


def _to_coarse(box):
    x1, y1, x2, y2, w, h = box
    if w <= 0 or h <= 0:
        raise SegmentationError("A person box has a zero frame size.")
    left = min(x1, x2) / w * 1000
    top = min(y1, y2) / h * 1000
    right = max(x1, x2) / w * 1000
    bottom = max(y1, y2) / h * 1000
    expand_x = max((right - left) * EXPAND_FRACTION, MIN_EXPAND_UNITS)
    expand_y = max((bottom - top) * EXPAND_FRACTION, MIN_EXPAND_UNITS)
    left = max(0, round(left - expand_x))
    top = max(0, round(top - expand_y))
    right = min(1000, round(right + expand_x))
    bottom = min(1000, round(bottom + expand_y))
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _intersects(first, second):
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def _merge(first, second):
    left = min(first["x"], second["x"])
    top = min(first["y"], second["y"])
    right = max(first["x"] + first["width"], second["x"] + second["width"])
    bottom = max(first["y"] + first["height"], second["y"] + second["height"])
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def coarse_person_rects(output_text):
    """Return merged coarse rectangles for every detected person.

    Multiple people yield multiple rectangles; intersecting rectangles are
    merged. Returns [] when nothing matched.
    """
    rects = [_to_coarse(box) for box in parse_boxes(output_text)]
    merged = []
    for rect in rects:
        for index, existing in enumerate(merged):
            if _intersects(rect, existing):
                merged[index] = _merge(rect, existing)
                break
        else:
            merged.append(rect)
    return merged
