"""Cross-language parity check. Run from the repo root: python eval/parity.py

Runs the Python engine over eval/parity_fixtures.json and asserts every
pinned field matches. The TypeScript engine asserts the same fixture file
in frontend/src/lib/parity.test.ts. Both suites must agree with the same
contract for the check to pass.
"""

import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend.align import compare_graphs

PINNED = (
    "usable_points",
    "aligned_points",
    "agreement_percent",
    "verdict",
    "mean_residual",
    "median_shift",
    "shift_spread",
    "uniform_shift",
)


def main():
    with open(
        os.path.join(PROJECT_ROOT, "eval", "parity_fixtures.json"), encoding="utf-8"
    ) as handle:
        fixtures = json.load(handle)
    failures = 0
    for case in fixtures["cases"]:
        result = compare_graphs(case["source"], case["suspect"])
        expected = case["expected"]
        problems = []
        for field in PINNED:
            if result[field] != expected[field]:
                problems.append(f"{field}: got {result[field]!r}, want {expected[field]!r}")
        got_res = [
            (item["name"], item["distance"], item["dx"], item["dy"], item["aligned"])
            for item in result["residuals"]
        ]
        want_res = [
            (item["name"], item["distance"], item["dx"], item["dy"], item["aligned"])
            for item in expected["residuals"]
        ]
        if got_res != want_res:
            problems.append(f"residuals: got {got_res!r}, want {want_res!r}")
        if problems:
            failures += 1
            print(f"FAIL {case['id']}")
            for problem in problems:
                print(f"  {problem}")
        else:
            print(f"ok {case['id']}")
    print(f"{len(fixtures['cases']) - failures}/{len(fixtures['cases'])} parity cases match")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
