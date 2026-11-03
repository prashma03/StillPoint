"""Strict scene-graph validation gate for Stillpoint.

This module is the import-time gate for scene graphs that arrive from files,
from a user, or from any future extraction pipeline. It fails closed: malformed,
out-of-range, duplicate, person-related, or empty graph data is rejected or
flagged here, before anything is stored or compared.

Two layers, two jobs:
- validate_graph (this module): strict. Rejects bad input with named errors.
- backend.align.compare_graphs: lenient. Never crashes; skips invalid objects
  and keeps its tested verdict behavior. The engine is the backstop, not the
  gate.

Relationship fields (occludes, is_above, is_below) are carried through as
written, but they are unverified observations: no model or check in this build
verifies them, and the alignment engine never scores them.

Coordinates use the 0-1000 scene-graph scale shared with backend.align.
"""

import math

from backend.align import (
    COORD_MAX,
    COORD_MIN,
    FORBIDDEN_NAMES,
    MIN_USABLE_FOR_VERDICT,
)

RELATIONSHIP_KEYS = ("occludes", "is_above", "is_below")
COORD_KEYS = ("x", "y", "width", "height")


def _is_number(value):
    """Finite int/float only. Bools are rejected: True is not a coordinate."""
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def _clean_name(value):
    if not isinstance(value, str):
        return None
    name = value.strip()
    return name or None


def _clean_relationships(obj, name, errors):
    """Return relationship lists, or None when they are malformed."""
    cleaned = {}
    for key in RELATIONSHIP_KEYS:
        if key not in obj:
            continue
        value = obj[key]
        if not isinstance(value, list) or any(
            not isinstance(item, str) for item in value
        ):
            errors.append(
                {
                    "code": "bad_relationships",
                    "message": (
                        f'"{name}" has a "{key}" field that is not a list '
                        "of names."
                    ),
                }
            )
            return None
        cleaned[key] = list(value)
    return cleaned


def validate_graph(data):
    """Strictly validate one scene graph.

    Returns a dict with:
    - ok: True only when the graph may be stored or compared.
    - graph: cleaned graph (person-named objects removed) or None.
    - errors: fatal problems, each {code, message}.
    - warnings: non-fatal notes, each {code, message}.
    - report: counts and flags describing what was found.
    """
    errors = []
    warnings = []
    report = {
        "object_count": 0,
        "excluded_people": 0,
        "duplicates": 0,
        "invalid": 0,
        "has_relationships": False,
        "coverage_percent": None,
        "sufficient_for_comparison": False,
    }

    if not isinstance(data, dict):
        errors.append(
            {"code": "not_an_object", "message": "A scene graph must be a JSON object."}
        )
        return _verdict(False, None, errors, warnings, report)

    items = data.get("room_objects")
    if not isinstance(items, list):
        errors.append(
            {
                "code": "missing_room_objects",
                "message": "Expected room_objects: a list of named background objects.",
            }
        )
        return _verdict(False, None, errors, warnings, report)
    if not items:
        errors.append(
            {
                "code": "empty_graph",
                "message": "No background objects were provided. There is nothing to compare.",
            }
        )
        return _verdict(False, None, errors, warnings, report)

    room_objects = []
    seen = set()
    for index, obj in enumerate(items):
        where = f"Object {index + 1}"
        if not isinstance(obj, dict):
            report["invalid"] += 1
            errors.append(
                {"code": "unreadable_object", "message": f"{where} is not readable."}
            )
            continue
        name = _clean_name(obj.get("name"))
        if name is None:
            report["invalid"] += 1
            errors.append(
                {
                    "code": "missing_name",
                    "message": f"{where} needs a name.",
                }
            )
            continue
        canonical = name.lower()
        if canonical in FORBIDDEN_NAMES:
            report["excluded_people"] += 1
            continue
        bad_coord = None
        for key in COORD_KEYS:
            value = obj.get(key)
            if not _is_number(value):
                bad_coord = key
                break
            if value < COORD_MIN or value > COORD_MAX:
                bad_coord = key
                break
        if bad_coord is not None:
            report["invalid"] += 1
            errors.append(
                {
                    "code": "bad_coordinates",
                    "message": (
                        f'"{name}" needs numeric x, y, width, and height '
                        "between 0 and 1000."
                    ),
                }
            )
            continue
        if canonical in seen:
            report["duplicates"] += 1
            errors.append(
                {
                    "code": "duplicate_name",
                    "message": f'"{name}" appears more than once. Rename or remove the repeat.',
                }
            )
            continue
        seen.add(canonical)
        rels = _clean_relationships(obj, name, errors)
        if rels is None:
            report["invalid"] += 1
            continue
        if rels:
            report["has_relationships"] = True
        room_objects.append(
            {
                "name": name,
                "x": obj["x"],
                "y": obj["y"],
                "width": obj["width"],
                "height": obj["height"],
                **rels,
            }
        )

    coverage = data.get("coverage_percent")
    if coverage is not None:
        if not _is_number(coverage):
            errors.append(
                {
                    "code": "bad_coverage",
                    "message": "coverage_percent must be a number when provided.",
                }
            )
        else:
            report["coverage_percent"] = coverage
    total = data.get("total_stable_points")
    if total is not None and not _is_number(total):
        errors.append(
            {
                "code": "bad_total",
                "message": "total_stable_points must be a number when provided.",
            }
        )

    if report["excluded_people"]:
        warnings.append(
            {
                "code": "people_excluded",
                "message": (
                    f'{report["excluded_people"]} person-named '
                    "object(s) were excluded. People are never reference points."
                ),
            }
        )

    graph = None
    if not errors:
        if not room_objects:
            errors.append(
                {
                    "code": "no_background",
                    "message": (
                        "Only person-named objects were provided. "
                        "There is no background evidence to compare."
                    ),
                }
            )
        else:
            graph = {"room_objects": room_objects}
            if report["coverage_percent"] is not None:
                graph["coverage_percent"] = report["coverage_percent"]
            if total is not None:
                graph["total_stable_points"] = total

    report["object_count"] = len(room_objects)
    report["sufficient_for_comparison"] = len(room_objects) >= MIN_USABLE_FOR_VERDICT
    if graph is not None and not report["sufficient_for_comparison"]:
        warnings.append(
            {
                "code": "insufficient_detail",
                "message": (
                    f'Only {len(room_objects)} background object(s) provided; '
                    f"a decisive comparison needs at least {MIN_USABLE_FOR_VERDICT} "
                    "shared with the other graph."
                ),
            }
        )

    return _verdict(not errors, graph, errors, warnings, report)


def _verdict(ok, graph, errors, warnings, report):
    return {
        "ok": ok,
        "graph": graph,
        "errors": errors,
        "warnings": warnings,
        "report": report,
    }
