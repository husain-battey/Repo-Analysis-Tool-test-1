"""Compare my metric engine's output against a grader reference CSV.

Usage: python3 scripts/compare_reference.py <repo_path> <ref_sha> <reference.csv>

The reference CSV has one row per (object_type, path, author) where author is
either "ALL" (aggregate + modification_frequency + churn_rate) or a specific
"Name <email>" (author metrics + ownership).
"""
from __future__ import annotations

import csv
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.ingest import analyze_history  # noqa: E402
from app.metrics import (  # noqa: E402
    NO_MERGE,
    aggregate,
    authors_by_object,
    resolve_commit_set,
)


def load_reference(csv_path: Path) -> dict[tuple[str, str, str], dict]:
    out: dict[tuple[str, str, str], dict] = {}
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            out[(row["object_type"], row["path"], row["author"])] = row
    return out


def main() -> int:
    repo = Path(sys.argv[1]).resolve()
    ref_sha = sys.argv[2]
    csv_path = Path(sys.argv[3]).resolve()

    t0 = time.time()
    data = analyze_history(repo)
    idxs = resolve_commit_set(data, ref=ref_sha)
    print(f"parsed {len(data.commits)} commits / {len(idxs)} reachable from "
          f"{ref_sha[:12]} in {time.time() - t0:.1f}s")

    ref_rows = load_reference(csv_path)
    commit_total = len(idxs)

    # Objects = every path appearing in the diffs of commits in H (renames add
    # both the old and the new path), so unmeasured files show as all-zero rows.
    # Metrics aggregate over the measured rows only.
    obj_rows: dict[tuple[str, str], list] = defaultdict(list)
    for ci in idxs:
        for path in data.touched_by_commit.get(ci, ()):
            obj_rows.setdefault(("file", path), [])
            segs = path.split("/")
            for i in range(1, len(segs)):
                obj_rows.setdefault(("directory", "/".join(segs[:i])), [])
        for path, a, r in data.rows_by_commit.get(ci, ()):
            obj_rows.setdefault(("file", path), []).append((ci, path, a, r))
            segs = path.split("/")
            for i in range(1, len(segs)):
                obj_rows[("directory", "/".join(segs[:i]))].append((ci, path, a, r))
            obj_rows[("repository", "/")].append((ci, path, a, r))
    obj_rows.setdefault(("repository", "/"), [])

    mine: dict[tuple[str, str, str], dict] = {}
    for (kind, path), rows in obj_rows.items():
        mine[(kind, path, "ALL")] = aggregate(rows, commit_total)
        for author, m in authors_by_object(data, rows, commit_total, merge=NO_MERGE).items():
            mine[(kind, path, author)] = m

    ref_objs = {(k[0], k[1]) for k in ref_rows}
    my_objs = {(k[0], k[1]) for k in mine}
    missing, extra = sorted(ref_objs - my_objs), sorted(my_objs - ref_objs)
    print(f"objects: reference={len(ref_objs)} mine={len(my_objs)} "
          f"missing={len(missing)} extra={len(extra)}")
    for label, lst in (("missing", missing), ("extra", extra)):
        for item in lst[:10]:
            print(f"  {label}: {item}")

    int_fields = ["added", "removed", "growth", "churn", "modifications"]
    # reference column name -> my metric key
    float_map = {"modification_frequency": "mod_frequency",
                 "churn_rate": "churn_rate", "ownership": "ownership"}
    problems: dict[str, list] = defaultdict(list)
    matched_rows = 0
    for key, rrow in sorted(ref_rows.items()):
        mrow = mine.get(key)
        if mrow is None:
            problems[f"missing-row:{key[0]}"].append(key)
            continue
        matched_rows += 1
        for f in int_fields:
            if rrow[f] not in ("", None):
                if int(rrow[f]) != int(mrow.get(f, -1)):
                    problems[f"{f} ({key[0]})"].append((key[1], key[2], rrow[f], mrow.get(f)))
        for f, my_key in float_map.items():
            if rrow[f] not in ("", None):
                want, got = float(rrow[f]), mrow.get(my_key)
                if got is None or abs(want - float(got)) > 1e-9:
                    problems[f"{f} ({key[0]})"].append((key[1], key[2], want, got))

    print(f"rows: reference={len(ref_rows)} mine={len(mine)} "
          f"key-matched={matched_rows} missing-rows={len(problems.get('missing-row:file', []))}"
          f"+{len(problems.get('missing-row:directory', []))}"
          f"+{len(problems.get('missing-row:repository', []))}")
    total_problems = sum(len(v) for v in problems.values())
    if not total_problems:
        print("ALL REFERENCE ROWS MATCH")
        return 0
    print(f"PROBLEM CELLS: {total_problems}")
    for name, items in sorted(problems.items(), key=lambda kv: -len(kv[1])):
        print(f"\n  {name}: {len(items)}  e.g.")
        for it in items[:6]:
            print(f"    {it}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
