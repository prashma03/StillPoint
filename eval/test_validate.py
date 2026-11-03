"""Validator contract tests. Run from the repo root: python eval/test_validate.py"""

import os
import sys
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend.validate import validate_graph


def good_object(name="bed", **overrides):
    obj = {"name": name, "x": 100, "y": 450, "width": 380, "height": 300}
    obj.update(overrides)
    return obj


def good_graph(count=4):
    names = ["bed", "poster", "door", "rug", "desk", "shelf"]
    return {"room_objects": [good_object(names[i]) for i in range(count)]}


class ValidateTests(unittest.TestCase):
    def test_accepts_clean_graph(self):
        checked = validate_graph(good_graph())
        self.assertTrue(checked["ok"])
        self.assertEqual(checked["report"]["object_count"], 4)
        self.assertTrue(checked["report"]["sufficient_for_comparison"])
        self.assertEqual(checked["graph"]["room_objects"][0]["name"], "bed")

    def test_rejects_non_objects(self):
        for bad in (None, [], "graph", 42):
            checked = validate_graph(bad)
            self.assertFalse(checked["ok"])
            self.assertIsNone(checked["graph"])
            self.assertEqual(checked["errors"][0]["code"], "not_an_object")

    def test_rejects_missing_or_empty_lists(self):
        checked = validate_graph({})
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "missing_room_objects")
        checked = validate_graph({"room_objects": []})
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "empty_graph")
        checked = validate_graph({"room_objects": None})
        self.assertFalse(checked["ok"])

    def test_rejects_unreadable_objects(self):
        checked = validate_graph({"room_objects": ["bed", 42, None]})
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["report"]["invalid"], 3)
        self.assertTrue(
            all(item["code"] == "unreadable_object" for item in checked["errors"])
        )

    def test_rejects_missing_names(self):
        checked = validate_graph({"room_objects": [good_object(name="  ")]})
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "missing_name")
        checked = validate_graph({"room_objects": [good_object(name=None)]})
        self.assertFalse(checked["ok"])

    def test_rejects_bad_coordinates(self):
        for key, value in (
            ("x", -1),
            ("y", 1001),
            ("width", 5000),
            ("height", float("nan")),
            ("x", "far"),
            ("y", True),
            ("width", float("inf")),
        ):
            with self.subTest(key=key, value=value):
                checked = validate_graph({"room_objects": [good_object(**{key: value})]})
                self.assertFalse(checked["ok"])
                self.assertEqual(checked["errors"][0]["code"], "bad_coordinates")

    def test_accepts_coordinate_boundaries(self):
        graph = {
            "room_objects": [
                good_object("a", x=0, y=0, width=0, height=0),
                good_object("b", x=1000, y=1000, width=0, height=0),
            ]
        }
        checked = validate_graph(graph)
        self.assertTrue(checked["ok"])

    def test_rejects_duplicates_case_insensitively(self):
        graph = {
            "room_objects": [
                good_object("Bed"),
                good_object("  BED "),
                good_object("door"),
            ]
        }
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["report"]["duplicates"], 1)
        self.assertEqual(checked["errors"][0]["code"], "duplicate_name")

    def test_excludes_people_with_warning(self):
        graph = {
            "room_objects": [
                good_object("Face"),
                good_object("bed"),
                good_object("PERSON"),
            ]
        }
        checked = validate_graph(graph)
        self.assertTrue(checked["ok"])
        self.assertEqual(checked["report"]["excluded_people"], 2)
        self.assertEqual(checked["report"]["object_count"], 1)
        self.assertEqual(checked["warnings"][0]["code"], "people_excluded")
        self.assertEqual(
            [obj["name"] for obj in checked["graph"]["room_objects"]], ["bed"]
        )

    def test_person_only_graph_has_no_background(self):
        graph = {"room_objects": [good_object("face"), good_object("body")]}
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "no_background")

    def test_near_miss_names_are_background(self):
        graph = {
            "room_objects": [good_object("wardrobe"), good_object("headboard")]
        }
        checked = validate_graph(graph)
        self.assertTrue(checked["ok"])
        self.assertEqual(checked["report"]["excluded_people"], 0)

    def test_warns_on_insufficient_detail(self):
        checked = validate_graph(good_graph(count=2))
        self.assertTrue(checked["ok"])
        self.assertFalse(checked["report"]["sufficient_for_comparison"])
        codes = [item["code"] for item in checked["warnings"]]
        self.assertIn("insufficient_detail", codes)

    def test_rejects_bad_relationships(self):
        graph = {"room_objects": [good_object("bed", occludes="rug")]}
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "bad_relationships")
        graph = {"room_objects": [good_object("bed", is_above=["rug", 42])]}
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])

    def test_keeps_relationships_and_flags_them(self):
        obj = good_object("bed", occludes=["rug"], is_above=[], is_below=["rug"])
        checked = validate_graph({"room_objects": [obj]})
        self.assertTrue(checked["ok"])
        self.assertTrue(checked["report"]["has_relationships"])
        kept = checked["graph"]["room_objects"][0]
        self.assertEqual(kept["occludes"], ["rug"])

    def test_rejects_bad_coverage_and_total(self):
        graph = dict(good_graph())
        graph["coverage_percent"] = "high"
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "bad_coverage")
        graph = dict(good_graph())
        graph["total_stable_points"] = "many"
        checked = validate_graph(graph)
        self.assertFalse(checked["ok"])
        self.assertEqual(checked["errors"][0]["code"], "bad_total")

    def test_passes_coverage_through(self):
        graph = dict(good_graph())
        graph["coverage_percent"] = 42
        checked = validate_graph(graph)
        self.assertTrue(checked["ok"])
        self.assertEqual(checked["graph"]["coverage_percent"], 42)
        self.assertEqual(checked["report"]["coverage_percent"], 42)


if __name__ == "__main__":
    unittest.main()
