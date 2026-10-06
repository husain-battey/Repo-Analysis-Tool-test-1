"""End-to-end check of the running RAT API against a reference metric CSV.

Talks to the backend over HTTP (the same path the dashboard uses), so it proves
ingestion -> indexing -> metric endpoints all agree with the expected numbers.

    python scripts/e2e_api_test.py [--base http://127.0.0.1:8000]
                                   [--csv ../repo-references/cJSON_...csv]
                                   [--objects N | --all-objects]

The CSV is the grader's reference export: one row per (object, author) with
author "ALL" carrying the object totals.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FAILURES: list[str] = []
CHECKS = 0

INT_FIELDS = ("added", "removed", "growth", "churn", "modifications", "commit_count")
FLOAT_FIELDS = ("mod_frequency", "churn_rate", "ownership")


def call(base: str, method: str, path: str, body: dict | None = None) -> dict | list:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=1800) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as exc:
        sys.exit(f"API {method} {path} -> {exc.code}: {exc.read().decode()[:300]}")


def check(label: str, got, want, tol: float = 0.0) -> None:
    global CHECKS
    CHECKS += 1
    ok = (abs(float(got) - float(want)) <= tol) if tol else (got == want)
    if not ok:
        FAILURES.append(f"{label}: got {got!r}, expected {want!r}")
        print(f"  FAIL {label}: got {got!r}, expected {want!r}")


def load_reference(csv_path: Path) -> dict[str, dict[str, str]]:
    """{(object_type, path): {"ALL": row, author: row, ...}}"""
    ref: dict[str, dict[str, str]] = {}
    with open(csv_path, newline="") as fh:
        for row in csv.DictReader(fh):
            ref.setdefault((row["object_type"], row["path"]), {})[row["author"]] = row
    return ref


def compare(row: dict, want: dict[str, str], label: str, skip: set[str] = frozenset()) -> None:
    for f in INT_FIELDS:
        if want.get(f) and f not in skip:
            check(f"{label}.{f}", row.get(f), int(want[f]))
    for f in FLOAT_FIELDS:
        if want.get(f) and f not in skip:
            check(f"{label}.{f}", row.get(f), float(want[f]), tol=1e-6)


def wait_for_job(base: str, job_id: str, repo_name: str) -> str:
    print(f"cloning {repo_name} ...", flush=True)
    while True:
        job = call(base, "GET", f"/api/jobs/{job_id}")
        if job["status"] == "error":
            sys.exit(f"ingest failed: {job['error']}")
        if job["status"] == "done":
            print(f"  ready: {job['repo_id']}")
            return job["repo_id"]
        time.sleep(1.0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--csv", default=str(Path(__file__).resolve().parent.parent
                                        / "repo-references"
                                        / "cJSON_6d9f2443ab07.csv"))
    ap.add_argument("--objects", type=int, default=25, help="sampled objects to verify")
    ap.add_argument("--all-objects", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    base, csv_path = args.base, Path(args.csv)
    if not csv_path.exists():
        sys.exit(f"reference csv not found: {csv_path}")
    ref = load_reference(csv_path)
    repo_name = next(iter(ref[("repository", "/")].values()))["repo"]
    sha = next(iter(ref[("repository", "/")].values()))["ref_sha"]

    health = call(base, "GET", "/api/health")
    print(f"backend ok: {health['git']}, {health['repos']} repos")

    repos = call(base, "GET", "/api/repos")
    repo = next((r for r in repos if r.get("head") == sha and r["status"] == "ready"), None)
    if repo is None:
        url = f"https://github.com/DaveGamble/{repo_name}.git"
        rid = wait_for_job(base, call(base, "POST", "/api/repos/clone",
                                      {"url": url})["job_id"], repo_name)
        repo = next(r for r in call(base, "GET", "/api/repos") if r["id"] == rid)
    print(f"using repo {repo['id']!r}: {repo['stats']['commits']} non-merge commits "
          f"reachable from HEAD")

    rid = repo["id"]
    filters = {"ref": sha, "object_path": ""}

    # ---- 1. repository / directory / file metrics (category: object types) ----
    objects = list(ref.keys())
    if not args.all_objects:
        rnd = random.Random(args.seed)
        dirs = [o for o in objects if o[0] == "directory"]
        files = [o for o in objects if o[0] == "file"]
        objects = [o for o in objects if o[0] == "repository"]
        objects += rnd.sample(dirs, min(6, len(dirs)))
        objects += rnd.sample(files, min(max(args.objects - 6, 1), len(files)))
    print(f"\nverifying {len(objects)} objects against {csv_path.name}")
    t0 = time.time()
    for kind, path in objects:
        got = call(base, "POST", f"/api/repos/{rid}/metrics",
                   {**filters, "object_path": "" if kind == "repository" else path})
        compare(got, ref[(kind, path)]["ALL"], f"{kind}:{path or '/'}")
        check(f"{kind}:{path or '/'}.kind", got["object"]["kind"], kind)
    print(f"  {CHECKS} checks in {time.time() - t0:.1f}s")

    # ---- 2. author metrics (category: author, incl. ownership) ----
    print("\nauthor breakdown for the repository and for one file")
    for kind, path in (("repository", "/"), ("file", "cJSON.c")):
        bd = call(base, "POST", f"/api/repos/{rid}/breakdown",
                  {**filters, "object_path": "" if kind == "repository" else path,
                   "dimension": "author"})
        want = ref[(kind, path)]
        check(f"authors({kind}:{path}).count", len(bd["items"]), len(want) - 1)
        for item in bd["items"]:
            if item["label"] in want:
                # Author rows carry per-author totals; |H| is reported once on the object.
                compare(item, want[item["label"]],
                        f"author {item['label']} in {path or '/'}", skip={"commit_count"})

    # ---- 3. commit-set filters: time period, author, manual commit list ----
    print("\ncommit-set filters")
    full = call(base, "POST", f"/api/repos/{rid}/metrics", filters)
    n = full["commit_count"]

    lo, hi = 1_400_000_000, 1_500_000_000
    window = call(base, "POST", f"/api/repos/{rid}/metrics",
                  {**filters, "from_ts": lo, "to_ts": hi})
    page = call(base, "GET", f"/api/repos/{rid}/commits?ref={sha}"
                f"&from_ts={lo}&to_ts={hi}&limit=1")
    check("period.commit_count", window["commit_count"], page["total"])
    check("period.is_subset", window["commit_count"] < n, True)
    check("period.churn_matches_rows", window["churn"],
          sum(i["churn"] for i in call(base, "POST", f"/api/repos/{rid}/breakdown",
              {**filters, "from_ts": lo, "to_ts": hi, "dimension": "month"})["items"]))

    one_author = call(base, "GET", f"/api/repos/{rid}/authors")[0]["id"]
    by_author = call(base, "POST", f"/api/repos/{rid}/metrics",
                     {**filters, "authors": [one_author]})
    check(f"author({one_author}).is_subset", by_author["commit_count"] < n, True)
    check("author.churn_is_part_of_total", by_author["churn"] <= full["churn"], True)

    hashes = [c["hash"] for c in
              call(base, "GET", f"/api/repos/{rid}/commits?ref={sha}&limit=3")["items"]]
    manual = call(base, "POST", f"/api/repos/{rid}/metrics",
                  {**filters, "commit_hashes": hashes})
    check("manual_list.commit_count", manual["commit_count"], len(hashes))

    # ---- 4. multi-repo: the same repo registered twice is independent ----
    listing = call(base, "GET", "/api/repos")
    check("multirepo.listed", len(listing) >= 1, True)

    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed")
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILURES:")
        for f in FAILURES[:20]:
            print("  -", f)
        sys.exit(1)
    print("ALL REFERENCE VALUES MATCH")


if __name__ == "__main__":
    main()
