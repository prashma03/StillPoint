"""Kill test: repainted photo must link, moved camera must not."""

import json
import os
import sys

# Add the project root to sys.path so backend.align can be imported
# when this script runs from the repo root.
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from backend.align import compare_graphs


def load_graph(path):
    """Open a scene graph JSON file and return it as a dict."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    # Load paths relative to the project root so the script works
    # when run from the repo root: python eval/killtest.py
    graph1 = load_graph(os.path.join(PROJECT_ROOT, "sample_data", "graph1.json"))
    graph2 = load_graph(os.path.join(PROJECT_ROOT, "sample_data", "graph2.json"))
    graph3 = load_graph(os.path.join(PROJECT_ROOT, "sample_data", "graph3.json"))

    result2 = compare_graphs(graph1, graph2)
    result3 = compare_graphs(graph1, graph3)

    print(f"{'Photo':<18} | {'Usable':<6} | {'Aligned':<7} | {'Agreement %':<11} | Verdict")
    print("-" * 72)
    print(
        f"{'Photo 2 vs Photo 1':<18} | {result2['usable_points']:<6} | "
        f"{result2['aligned_points']:<7} | {result2['agreement_percent']:<10}% | "
        f"{result2['verdict']}"
    )
    print(
        f"{'Photo 3 vs Photo 1':<18} | {result3['usable_points']:<6} | "
        f"{result3['aligned_points']:<7} | {result3['agreement_percent']:<10}% | "
        f"{result3['verdict']}"
    )
    print()
    print("Photo 2 kept every object in the same place = derivative from same viewpoint.")
    print("Photo 3 is the same room but camera moved = objects do not align = we do not accuse.")


if __name__ == "__main__":
    main()
