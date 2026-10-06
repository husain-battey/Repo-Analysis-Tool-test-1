"""Metric computation engine.

Every metric derives from the per-commit (path, added, removed) row index:
  * file metrics    -> rows whose path equals the file
  * directory/repo  -> rows whose path lies under the directory prefix
                       (identical to the spec's recursive immediate-child sum)
  * commit-set      -> sums over a resolved commit set H
  * author metrics  -> the same rows grouped by the commit's author

Author identity is "Name <email>", with git's .mailmap already applied during
parsing (%aN / %aE). Manual merges are layered on top of that.
"""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from typing import Callable, Iterable, Optional

from .ingest import RepoData
from .store import MergeConfig

NO_MERGE = MergeConfig()


def commit_author(data: RepoData, idx: int, merge: MergeConfig = NO_MERGE) -> str:
    _h, name, email, _ts, _s = data.commits[idx]
    author = f"{name} <{email}>"
    return merge.effective(author) if merge.groups else author


# ---------------------------------------------------------------- authors ----
def authors_payload(data: RepoData, merge: MergeConfig) -> list[dict]:
    counts: Counter[str] = Counter()
    merged_from: dict[str, set[str]] = defaultdict(set)
    for i in range(len(data.commits)):
        _h, name, email, _ts, _s = data.commits[i]
        author = f"{name} <{email}>"
        canon = merge.effective(author) if merge.groups else author
        counts[canon] += 1
        if canon != author:
            merged_from[canon].add(author)
    out = [
        {"id": a, "commits": n, "merged_from": sorted(merged_from.get(a, ()))}
        for a, n in counts.items()
    ]
    out.sort(key=lambda r: (-r["commits"], r["id"]))
    return out


# ------------------------------------------------------------ commit sets ----
def resolve_commit_set(
    data: RepoData,
    ref: str = "HEAD",
    authors: Optional[list[str]] = None,
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    commit_hashes: Optional[list[str]] = None,
    merge: MergeConfig = NO_MERGE,
) -> set[int]:
    """H: non-merge commits reachable from `ref`, narrowed by the filters."""
    idxs = data.resolve_ref(ref)
    if commit_hashes:
        idxs = idxs & data.resolve_hashes(commit_hashes)
    if authors:
        want = set(authors)
        idxs = {i for i in idxs if commit_author(data, i, merge) in want}
    if from_ts is not None or to_ts is not None:
        keep: set[int] = set()
        for i in idxs:
            t = data.commits[i][3]
            if from_ts is not None and t < from_ts:
                continue
            if to_ts is not None and t >= to_ts:
                continue
            keep.add(i)
        idxs = keep
    return idxs


def object_kind(data: RepoData, path: str) -> str:
    if path in data.files:
        return "file"
    if path in data.dirs:
        return "directory"
    return "unknown"


def object_predicate(data: RepoData, object_path: str) -> tuple[str, Callable[[str], bool]]:
    obj = (object_path or "").strip().strip("/")
    if not obj:
        return "repository", (lambda p: True)
    if obj in data.files:
        return "file", (lambda p, o=obj: p == o)
    if obj in data.dirs:
        return "directory", (lambda p, d=obj: p.startswith(d + "/"))
    return "unknown", (lambda p: False)


def iter_rows(
    data: RepoData, idxs: set[int], pred: Callable[[str], bool]
) -> Iterable[tuple[int, str, int, int]]:
    for ci in idxs:
        for path, a, r in data.rows_by_commit.get(ci, ()):
            if pred(path):
                yield (ci, path, a, r)


def aggregate(rows: Iterable[tuple[int, str, int, int]], commit_total: int) -> dict:
    added = removed = 0
    mod_commits: set[int] = set()
    for ci, _p, a, r in rows:
        added += a
        removed += r
        if a + r > 0:
            mod_commits.add(ci)
    churn = added + removed
    n = commit_total
    return {
        "added": added,
        "removed": removed,
        "growth": added - removed,
        "churn": churn,
        "modifications": len(mod_commits),
        "mod_frequency": (len(mod_commits) / n) if n else 0.0,
        "churn_rate": (churn / n) if n else 0.0,
    }


def compute_metrics(data: RepoData, merge: MergeConfig, object_path: str = "", **commit_set) -> dict:
    """Metrics for one object: a file, a directory, or the repository root.

    `object_path` picks the measured object; every remaining filter key narrows the
    commit set H and is forwarded untouched to resolve_commit_set.
    """
    idxs = resolve_commit_set(data, merge=merge, **commit_set)
    kind, pred = object_predicate(data, object_path)
    m = aggregate(iter_rows(data, idxs, pred), len(idxs))
    m["object"] = {
        "kind": kind,
        "path": (object_path or "").strip().strip("/") or "/",
    }
    m["commit_count"] = len(idxs)
    return m


# ------------------------------------------------------------- author rows ----
def authors_by_object(
    data: RepoData,
    rows: Iterable[tuple[int, str, int, int]],
    commit_total: int,
    total_churn: Optional[int] = None,
    merge: MergeConfig = NO_MERGE,
) -> dict[str, dict]:
    """Per-author metric rows for one object (author modifications/churn/ownership)."""
    per: dict[str, list] = defaultdict(list)
    row_list = list(rows)
    if total_churn is None:
        total_churn = sum(a + r for _ci, _p, a, r in row_list)
    for ci, path, a, r in row_list:
        per[commit_author(data, ci, merge)].append((ci, path, a, r))
    out = {}
    for author, sub in per.items():
        m = aggregate(sub, commit_total)
        m["ownership"] = (m["churn"] / total_churn) if total_churn else 0.0
        out[author] = m
    return out


# -------------------------------------------------------------- breakdowns ----
def _strip_prefix(object_path: str, path: str) -> str:
    obj = (object_path or "").strip().strip("/")
    return path[len(obj) + 1:] if obj else path


def compute_breakdown(
    data: RepoData, merge: MergeConfig, dimension: str, object_path: str = "", **commit_set
) -> dict:
    """One breakdown of the object's metrics along `dimension`."""
    idxs = resolve_commit_set(data, merge=merge, **commit_set)
    object_path = (object_path or "").strip().strip("/")
    kind, pred = object_predicate(data, object_path)
    commit_total = len(idxs)
    base = {"object": {"kind": kind, "path": object_path or "/"},
            "commit_count": commit_total}
    if kind == "unknown":
        base["items"] = []
        return base

    rows = list(iter_rows(data, idxs, pred))

    if dimension == "author":
        total_churn = sum(a + r for _ci, _p, a, r in rows)
        items = []
        for author, m in authors_by_object(data, rows, commit_total, total_churn, merge).items():
            items.append({"key": author, "label": author, "total_churn": total_churn, **m})
        items.sort(key=lambda r: (-r["churn"], r["key"]))

    elif dimension == "month":
        groups: dict[str, list] = defaultdict(list)
        for ci, path, a, r in rows:
            ts = data.commits[ci][3]
            groups[time.strftime("%Y-%m", time.gmtime(ts))].append((ci, path, a, r))
        items = [{"key": k, "label": k, **aggregate(v, commit_total)}
                 for k, v in groups.items()]
        items.sort(key=lambda r: r["key"])

    elif dimension == "file":
        groups = defaultdict(list)
        for ci, path, a, r in rows:
            groups[path].append((ci, path, a, r))
        items = [{"key": k, "label": k, "path": k, "kind": "file",
                  **aggregate(v, commit_total)} for k, v in groups.items()]
        items.sort(key=lambda r: (-r["churn"], r["key"]))

    else:  # "child": immediate files and directories below the object
        groups = defaultdict(list)
        for ci, path, a, r in rows:
            rel = _strip_prefix(object_path, path)
            groups[rel.split("/", 1)[0]].append((ci, path, a, r))
        items = []
        for seg, sub in groups.items():
            full = f"{object_path}/{seg}" if object_path else seg
            items.append({"key": seg, "label": seg, "path": full,
                          "kind": object_kind(data, full),
                          **aggregate(sub, commit_total)})
        items.sort(key=lambda r: (r["kind"] == "file", -r["churn"], r["key"]))

    base["items"] = items
    base["totals"] = aggregate(rows, commit_total)
    return base


# -------------------------------------------------------------- commits API ----
def search_commits(
    data: RepoData,
    query: str = "",
    authors: Optional[list[str]] = None,
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    ref: str = "HEAD",
    limit: int = 100,
    offset: int = 0,
    merge: MergeConfig = NO_MERGE,
) -> dict:
    idxs = data.resolve_ref(ref)
    if authors:
        want = set(authors)
        idxs = {i for i in idxs if commit_author(data, i, merge) in want}
    q = (query or "").strip().lower()
    matched = []
    for i in idxs:
        h, name, email, ts, subj = data.commits[i]
        if from_ts is not None and ts < from_ts:
            continue
        if to_ts is not None and ts >= to_ts:
            continue
        if q and q not in h.lower() and q not in subj.lower() \
                and q not in name.lower() and q not in email.lower():
            continue
        matched.append(i)
    matched.sort(key=lambda i: (-data.commits[i][3], -i))
    total = len(matched)
    items = [
        {"idx": i, "hash": data.commits[i][0], "hash_short": data.commits[i][0][:10],
         "author": f"{data.commits[i][1]} <{data.commits[i][2]}>",
         "committer_ts": data.commits[i][3], "subject": data.commits[i][4]}
        for i in matched[offset: offset + limit]
    ]
    return {"total": total, "items": items, "limit": limit, "offset": offset}
