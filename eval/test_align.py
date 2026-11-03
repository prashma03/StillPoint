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

    def test_zero_overlap_is_cannot_determine(self):
        source = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "poster", "x": 180, "y": 150, "width": 200, "height": 150},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "curtain", "x": 40, "y": 40, "width": 220, "height": 320},
                {"name": "lamp", "x": 640, "y": 180, "width": 90, "height": 180},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["usable_points"], 0)
        self.assertEqual(result["aligned_points"], 0)
        self.assertEqual(result["agreement_percent"], 0.0)
        self.assertIsNone(result["mean_residual"])
        self.assertEqual(result["residuals"], [])
        self.assertEqual(result["verdict"], "Cannot determine")
        self.assertNotEqual(result["verdict"], "No link found")

    def test_too_few_objects_is_cannot_determine(self):
        # Three shared and fully aligned is still insufficient evidence.
        aligned = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "poster", "x": 180, "y": 150, "width": 200, "height": 150},
                {"name": "door", "x": 750, "y": 200, "width": 180, "height": 450},
            ]
        }
        result = compare_graphs(aligned, aligned)
        self.assertEqual(result["usable_points"], 3)
        self.assertEqual(result["agreement_percent"], 100.0)
        self.assertEqual(result["verdict"], "Cannot determine")

        # Three shared and fully misaligned must not be a negative verdict.
        moved = {
            "room_objects": [
                {"name": "bed", "x": 500, "y": 100, "width": 380, "height": 300},
                {"name": "poster", "x": 600, "y": 600, "width": 200, "height": 150},
                {"name": "door", "x": 100, "y": 100, "width": 180, "height": 450},
            ]
        }
        result = compare_graphs(aligned, moved)
        self.assertEqual(result["usable_points"], 3)
        self.assertEqual(result["aligned_points"], 0)
        self.assertEqual(result["verdict"], "Cannot determine")
        self.assertNotEqual(result["verdict"], "No link found")

    def test_identical_graphs(self):
        result = compare_graphs(GRAPH1, GRAPH1)
        self.assertEqual(result["usable_points"], 4)
        self.assertEqual(result["aligned_points"], 4)
        self.assertEqual(result["agreement_percent"], 100.0)
        self.assertEqual(result["mean_residual"], 0.0)
        self.assertEqual(result["verdict"], "Likely derivative")

        small = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300}
            ]
        }
        result = compare_graphs(small, small)
        self.assertEqual(result["verdict"], "Cannot determine")

    def test_mismatched_graphs(self):
        moved = {
            "room_objects": [
                {"name": "bed", "x": 500, "y": 100, "width": 380, "height": 300},
                {"name": "poster", "x": 600, "y": 600, "width": 200, "height": 150},
                {"name": "door", "x": 100, "y": 100, "width": 180, "height": 450},
                {"name": "rug", "x": 600, "y": 100, "width": 400, "height": 150},
            ]
        }
        result = compare_graphs(GRAPH1, moved)
        self.assertEqual(result["usable_points"], 4)
        self.assertEqual(result["aligned_points"], 0)
        self.assertEqual(result["agreement_percent"], 0.0)
        self.assertEqual(result["verdict"], "No link found")

    def test_missing_coverage(self):
        self.assertIsNone(compare_graphs(GRAPH1, GRAPH2)["suspect_coverage_percent"])
        source = {"room_objects": list(GRAPH1["room_objects"]), "coverage_percent": 42}
        suspect = {"room_objects": list(GRAPH2["room_objects"])}
        result = compare_graphs(source, suspect)
        self.assertEqual(result["source_coverage_percent"], 42)
        self.assertIsNone(result["suspect_coverage_percent"])
        suspect["coverage_percent"] = 7
        result = compare_graphs(source, suspect)
        self.assertEqual(result["suspect_coverage_percent"], 7)
        # Non-numeric coverage is not passed through.
        suspect["coverage_percent"] = "high"
        self.assertIsNone(compare_graphs(source, suspect)["suspect_coverage_percent"])

    def test_person_objects_case_insensitive(self):
        source = {
            "room_objects": [
                {"name": "  Face ", "x": 0, "y": 0, "width": 40, "height": 40},
                {"name": "PERSON", "x": 10, "y": 10, "width": 40, "height": 40},
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "Body", "x": 10, "y": 10, "width": 20, "height": 80},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["excluded_person_objects"], 3)
        self.assertEqual([item["name"] for item in result["residuals"]], ["bed"])
        # Near-miss names are background objects, never person matches.
        wardrobe = {
            "room_objects": [
                {"name": "wardrobe", "x": 100, "y": 100, "width": 100, "height": 200},
                {"name": "headboard", "x": 300, "y": 100, "width": 100, "height": 200},
            ]
        }
        result = compare_graphs(wardrobe, wardrobe)
        self.assertEqual(result["excluded_person_objects"], 0)
        self.assertEqual(result["usable_points"], 2)
        # Person-only graphs have no usable background evidence.
        people = {
            "room_objects": [
                {"name": "face", "x": 0, "y": 0, "width": 40, "height": 40},
            ]
        }
        result = compare_graphs(people, people)
        self.assertEqual(result["usable_points"], 0)
        self.assertEqual(result["verdict"], "Cannot determine")

    def test_name_normalization(self):
        source = {
            "room_objects": [
                {"name": "Bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "  POSTER  ", "x": 180, "y": 150, "width": 200, "height": 150},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "bed", "x": 102, "y": 451, "width": 380, "height": 300},
                {"name": "poster", "x": 181, "y": 149, "width": 200, "height": 150},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["usable_points"], 2)
        self.assertEqual(result["aligned_points"], 2)
        self.assertEqual(
            [item["name"] for item in result["residuals"]], ["bed", "poster"]
        )

    def test_duplicates_keep_first(self):
        source = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "Bed", "x": 900, "y": 900, "width": 50, "height": 50},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "bed", "x": 102, "y": 451, "width": 380, "height": 300},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["usable_points"], 1)
        self.assertEqual(result["duplicate_objects"], 1)
        self.assertEqual(result["aligned_points"], 1)
        self.assertLess(result["residuals"][0]["distance"], 25)

    def test_invalid_coordinates_are_skipped(self):
        source = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
                {"name": "poster", "x": -5, "y": 150, "width": 200, "height": 150},
                {"name": "door", "x": 750, "y": 200, "width": 180, "height": 4500},
                {"name": "rug", "x": 150, "y": 700, "width": 400},
                {"name": "desk", "x": "far", "y": 100, "width": 100, "height": 100},
                {"name": "", "x": 10, "y": 10, "width": 10, "height": 10},
                {"name": None, "x": 10, "y": 10, "width": 10, "height": 10},
                "not-an-object",
                {"name": "chair", "x": True, "y": 10, "width": 10, "height": 10},
                {"name": "shelf", "x": float("nan"), "y": 10, "width": 10, "height": 10},
            ]
        }
        suspect = {
            "room_objects": [
                {"name": "bed", "x": 100, "y": 450, "width": 380, "height": 300},
            ]
        }
        result = compare_graphs(source, suspect)
        self.assertEqual(result["usable_points"], 1)
        self.assertEqual(result["invalid_objects"], 9)
        self.assertEqual(result["verdict"], "Cannot determine")

    def test_coordinate_boundaries(self):
        edge = {
            "room_objects": [
                {"name": "a", "x": 0, "y": 0, "width": 0, "height": 0},
                {"name": "b", "x": 1000, "y": 1000, "width": 0, "height": 0},
            ]
        }
        result = compare_graphs(edge, edge)
        self.assertEqual(result["usable_points"], 2)
        self.assertEqual(result["invalid_objects"], 0)
        outside = {
            "room_objects": [
                {"name": "a", "x": -1, "y": 0, "width": 10, "height": 10},
                {"name": "b", "x": 0, "y": 1001, "width": 10, "height": 10},
            ]
        }
        result = compare_graphs(outside, outside)
        self.assertEqual(result["usable_points"], 0)
        self.assertEqual(result["invalid_objects"], 4)
        self.assertEqual(result["verdict"], "Cannot determine")

    def test_malformed_graphs_do_not_crash(self):
        self.assertEqual(compare_graphs({}, {})["verdict"], "Cannot determine")
        self.assertEqual(
            compare_graphs({"room_objects": None}, {"room_objects": []})["usable_points"],
            0,
        )
        self.assertEqual(
            compare_graphs({"room_objects": {}}, GRAPH1)["verdict"], "Cannot determine"
        )
        self.assertEqual(compare_graphs(None, None)["verdict"], "Cannot determine")

    def test_clean_samples_report_zero_rejects(self):
        result = compare_graphs(GRAPH1, GRAPH2)
        self.assertEqual(result["invalid_objects"], 0)
        self.assertEqual(result["duplicate_objects"], 0)


if __name__ == "__main__":
    unittest.main()
