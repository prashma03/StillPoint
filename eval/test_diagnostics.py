"""Shift-diagnostic contract tests. Run from the repo root: python eval/test_diagnostics.py

Diagnostics are informational only. These tests pin the displacement math and
the rule that diagnostics never change the verdict.
"""

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
GRAPH2 = load("graph2.json")
GRAPH3 = load("graph3.json")


class DiagnosticTests(unittest.TestCase):
    def test_derivative_shifts(self):
        result = compare_graphs(GRAPH1, GRAPH2)
        self.assertEqual(result["median_shift"], [1.0, 0.0])
        self.assertEqual(result["shift_spread"], 3.16)
        self.assertTrue(result["uniform_shift"])
        self.assertEqual(
            [(item["dx"], item["dy"]) for item in result["residuals"]],
            [(4.0, 1.0), (1.0, -1.0), (-1.0, 2.0), (1.0, -1.0)],
        )

    def test_moved_camera_shifts(self):
        result = compare_graphs(GRAPH1, GRAPH3)
        self.assertEqual(result["median_shift"], [7.5, -17.5])
        self.assertEqual(result["shift_spread"], 92.53)
        self.assertFalse(result["uniform_shift"])

    def test_no_overlap_has_no_shift(self):
        source = {"room_objects": [{"name": "bed", "x": 0, "y": 0, "width": 10, "height": 10}]}
        suspect = {"room_objects": [{"name": "lamp", "x": 0, "y": 0, "width": 10, "height": 10}]}
        result = compare_graphs(source, suspect)
        self.assertIsNone(result["median_shift"])
        self.assertIsNone(result["shift_spread"])
        self.assertFalse(result["uniform_shift"])

    def test_single_correspondence_has_zero_spread(self):
        graph = {"room_objects": [{"name": "bed", "x": 100, "y": 100, "width": 50, "height": 50}]}
        moved = {"room_objects": [{"name": "bed", "x": 130, "y": 140, "width": 50, "height": 50}]}
        result = compare_graphs(graph, moved)
        self.assertEqual(result["median_shift"], [30.0, 40.0])
        self.assertEqual(result["shift_spread"], 0.0)
        self.assertFalse(result["uniform_shift"])

    def test_uniform_shift_never_overrides_verdict(self):
        # Every object moved together by (+80, 0): consistent with a crop, but
        # the engine stays conservative and reports No link found.
        names = ["bed", "poster", "door", "rug"]
        source = {
            "room_objects": [
                {"name": name, "x": 100 + i * 100, "y": 200, "width": 60, "height": 60}
                for i, name in enumerate(names)
            ]
        }
        suspect = {
            "room_objects": [
                {"name": name, "x": 180 + i * 100, "y": 200, "width": 60, "height": 60}
                for i, name in enumerate(names)
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["verdict"], "No link found")
        self.assertEqual(result["median_shift"], [80.0, 0.0])
        self.assertEqual(result["shift_spread"], 0.0)
        self.assertTrue(result["uniform_shift"])


if __name__ == "__main__":
    unittest.main()
