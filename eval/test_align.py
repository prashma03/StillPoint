"""Alignment contract tests. Run from the repo root: python eval/test_align.py"""

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


class AlignTests(unittest.TestCase):
    def test_derivative_sample(self):
        result = compare_graphs(GRAPH1, GRAPH2)
        self.assertEqual(result["verdict"], "Likely derivative")
        self.assertEqual(result["usable_points"], 4)
        self.assertEqual(result["aligned_points"], 4)
        self.assertEqual(result["agreement_percent"], 100.0)
        self.assertEqual(result["mean_residual"], 2.3)
        self.assertEqual(
            [item["distance"] for item in result["residuals"]],
            [4.12, 1.41, 2.24, 1.41],
        )
        self.assertIsNone(result["source_coverage_percent"])
        self.assertEqual(result["excluded_person_objects"], 0)

    def test_moved_camera_sample(self):
        result = compare_graphs(GRAPH1, GRAPH3)
        self.assertEqual(result["verdict"], "No link found")
        self.assertEqual(result["usable_points"], 4)
        self.assertEqual(result["aligned_points"], 1)
        self.assertEqual(result["agreement_percent"], 25.0)
        self.assertEqual(result["mean_residual"], 55.58)
        self.assertEqual(result["residuals"][0]["name"], "bed")
        self.assertTrue(result["residuals"][0]["aligned"])
        self.assertFalse(result["residuals"][1]["aligned"])

    def test_person_names_are_excluded(self):
        source = {
            "room_objects": [
                {"name": "face", "x": 0, "y": 0, "width": 40, "height": 40},
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "body", "x": 10, "y": 10, "width": 20, "height": 80},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["usable_points"], 1)
        self.assertEqual(result["excluded_person_objects"], 2)
        self.assertEqual([item["name"] for item in result["residuals"]], ["bed"])
        self.assertNotEqual(result["verdict"], "Likely derivative")

    def test_coverage_is_not_invented(self):
        graph = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300}
            ],
            "coverage_percent": 12,
        }
        result = compare_graphs(graph, graph)
        self.assertEqual(result["source_coverage_percent"], 12)
        self.assertEqual(result["verdict"], "Cannot determine")

    def test_verdict_strings_stay_closed(self):
        allowed = {"Likely derivative", "No link found", "Cannot determine"}
        for other in (GRAPH2, GRAPH3):
            self.assertIn(compare_graphs(GRAPH1, other)["verdict"], allowed)


if __name__ == "__main__":
    unittest.main()
