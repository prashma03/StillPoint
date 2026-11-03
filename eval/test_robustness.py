"""Robustness evaluation. Run from the repo root: python eval/test_robustness.py

Ten synthetic, graph-level scenarios with real engine measurements. These
are geometry fixtures, not photographs: they measure how the comparison
engine responds to controlled layout changes. Real-photo evaluation needs
MODEL_API_KEY plus consented, non-sensitive photographs and is NOT run
here; see README for the protocol.

Expected classes:
- should-link: identical, resampled, brightness-equivalent, small edit
- should-not-link: moved viewpoint, different room
- inconclusive: cropped, occluded, insufficient detail
- invariant: person present (verdict must not change vs. baseline)
"""

import copy
import json
import os
import sys
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend.align import compare_graphs


def load(name):
    with open(os.path.join(PROJECT_ROOT, "sample_data", name), encoding="utf-8") as handle:
        return json.load(handle)


GRAPH1 = load("graph1.json")
GRAPH3 = load("graph3.json")


def zoom_and_crop(graph, scale=1.5):
    """Scale about the frame center; drop objects that leave the frame."""
    origin = 500
    room_objects = []
    for obj in graph["room_objects"]:
        cx = obj["x"] + obj["width"] / 2
        cy = obj["y"] + obj["height"] / 2
        nx = origin + (cx - origin) * scale
        ny = origin + (cy - origin) * scale
        if nx < 0 or nx > 1000 or ny < 0 or ny > 1000:
            continue
        width = obj["width"] * scale
        height = obj["height"] * scale
        room_objects.append(
            {**obj, "x": nx - width / 2, "y": ny - height / 2,
             "width": width, "height": height}
        )
    return {"room_objects": room_objects}


def scenarios():
    """Return [(name, expected_class, source, suspect)]."""
    jittered = copy.deepcopy(GRAPH1)
    for obj in jittered["room_objects"]:
        obj["x"] *= 1.02
        obj["y"] *= 1.02

    small_edit = copy.deepcopy(GRAPH1)
    small_edit["room_objects"][0]["x"] += 10
    small_edit["room_objects"][0]["y"] += 10

    other_room = {
        "room_objects": [
            {"name": "bed", "x": 600, "y": 100, "width": 300, "height": 250},
            {"name": "poster", "x": 50, "y": 600, "width": 200, "height": 150},
            {"name": "door", "x": 100, "y": 100, "width": 150, "height": 400},
            {"name": "rug", "x": 650, "y": 650, "width": 300, "height": 120},
        ]
    }

    occluded = {"room_objects": copy.deepcopy(GRAPH1["room_objects"][:2])}

    thin = {"room_objects": copy.deepcopy(GRAPH1["room_objects"][:1])}

    with_people = copy.deepcopy(GRAPH1)
    with_people["room_objects"].append(
        {"name": "face", "x": 400, "y": 300, "width": 80, "height": 100}
    )
    with_people["room_objects"].append(
        {"name": "body", "x": 380, "y": 400, "width": 140, "height": 300}
    )

    return [
        ("1 identical", "should-link", GRAPH1, copy.deepcopy(GRAPH1)),
        ("2 cropped", "inconclusive", GRAPH1, zoom_and_crop(GRAPH1)),
        ("3 resampled", "should-link", GRAPH1, jittered),
        ("4 brightness-equivalent", "should-link", GRAPH1, copy.deepcopy(GRAPH1)),
        ("5 small background edit", "should-link", GRAPH1, small_edit),
        ("6 moved viewpoint", "should-not-link", GRAPH1, GRAPH3),
        ("7 different room", "should-not-link", GRAPH1, other_room),
        ("8 occluded background", "inconclusive", GRAPH1, occluded),
        ("9 person present", "invariant", GRAPH1, with_people),
        ("10 insufficient detail", "inconclusive", GRAPH1, thin),
    ]


def measured_table():
    rows = []
    for name, expected, source, suspect in scenarios():
        result = compare_graphs(source, suspect)
        rows.append((name, expected, result))
    return rows


class RobustnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {name: (expected, result) for name, expected, result in measured_table()}

    def test_links_hold(self):
        for name in ("1 identical", "3 resampled", "4 brightness-equivalent",
                     "5 small background edit"):
            with self.subTest(name=name):
                _, result = self.results[name]
                self.assertEqual(result["verdict"], "Likely derivative")

    def test_non_links_hold(self):
        for name in ("6 moved viewpoint", "7 different room"):
            with self.subTest(name=name):
                _, result = self.results[name]
                self.assertEqual(result["verdict"], "No link found")

    def test_inconclusive_hold(self):
        for name in ("2 cropped", "8 occluded background", "10 insufficient detail"):
            with self.subTest(name=name):
                _, result = self.results[name]
                self.assertEqual(result["verdict"], "Cannot determine")

    def test_crop_loses_a_reference_point(self):
        _, result = self.results["2 cropped"]
        self.assertEqual(result["usable_points"], 3)

    def test_person_objects_do_not_change_the_verdict(self):
        baseline = compare_graphs(GRAPH1, GRAPH1)
        _, result = self.results["9 person present"]
        self.assertEqual(result["verdict"], baseline["verdict"])
        self.assertEqual(result["usable_points"], baseline["usable_points"])
        self.assertEqual(result["excluded_person_objects"], 2)

    def test_no_false_links_or_misses(self):
        false_positives = [
            name for name, (expected, result) in self.results.items()
            if expected == "should-not-link" and result["verdict"] == "Likely derivative"
        ]
        false_negatives = [
            name for name, (expected, result) in self.results.items()
            if expected == "should-link" and result["verdict"] != "Likely derivative"
        ]
        inconclusive = [
            name for name, (expected, result) in self.results.items()
            if result["verdict"] == "Cannot determine"
        ]
        self.assertEqual(false_positives, [])
        self.assertEqual(false_negatives, [])
        self.assertEqual(len(inconclusive), 3)


def print_table():
    print(f"{'Scenario':<26} | {'Expected':<14} | {'Usable':<6} | {'Aligned':<7} | {'Agreement %':<11} | Verdict")
    print("-" * 96)
    for name, expected, result in measured_table():
        print(
            f"{name:<26} | {expected:<14} | {result['usable_points']:<6} | "
            f"{result['aligned_points']:<7} | {result['agreement_percent']:<10}% | "
            f"{result['verdict']}"
        )
    print()
    print("Synthetic geometry fixtures. Not photographs, not people.")


if __name__ == "__main__":
    print_table()
    unittest.main(argv=[sys.argv[0]])
