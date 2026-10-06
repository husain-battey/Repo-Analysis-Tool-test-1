"""RAT — Repo Analysis Tool HTTP API (FastAPI).

Serves the metric engine to the Next.js dashboard. Data layout under
backend/data/: repos/<id>/ (pristine git checkout), meta/<id>.json (registry),
analysis/<id>.pkl (index cache) and analysis/<id>.merge.json (author merges).
Side-car files are kept outside the checkout so `git` only ever sees the repo.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import metrics as M
from .ingest import analyze_history, clone_url, extract_zip
from .store import MergeConfig, UPLOADS_DIR, store

app = FastAPI(title="RAT — Repo Analysis Tool", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ models ----
class CloneRequest(BaseModel):
    url: str


class MergeRequest(BaseModel):
    groups: list[list[str]]


class Filters(BaseModel):
    ref: str = "HEAD"
    object_path: str = ""
    authors: Optional[list[str]] = None
    from_ts: Optional[int] = None
    to_ts: Optional[int] = None
    commit_hashes: Optional[list[str]] = None


class BreakdownRequest(Filters):
    dimension: str = "child"  # child | file | author | month


def _filters(f: Filters) -> dict:
    return {
        "ref": f.ref or "HEAD",
        "object_path": f.object_path or "",
        "authors": f.authors or None,
        "from_ts": f.from_ts,
        "to_ts": f.to_ts,
        "commit_hashes": f.commit_hashes or None,
    }


def _repo_or_404(repo_id: str):
    meta = store.repo_meta(repo_id)
    if meta is None:
        raise HTTPException(404, f"Unknown repository: {repo_id!r}")
    return meta


def _data_or_500(repo_id: str):
    try:
        return store.get_data(repo_id)
    except FileNotFoundError:
        raise HTTPException(409, "Repository is still being analyzed")
    except Exception as exc:
        raise HTTPException(500, f"Could not load analysis: {exc}")


def _merge(repo_id: str) -> MergeConfig:
    return MergeConfig.load(store.merge_path(repo_id))


# ------------------------------------------------------------------- meta ----
@app.get("/api/health")
def health() -> dict:
    try:
        git_version = subprocess.run(["git", "--version"], capture_output=True,
                                     text=True).stdout.strip()
    except Exception:
        git_version = "git not found"
    return {"status": "ok", "git": git_version or "unknown",
            "repos": len(store.list_repos())}


@app.get("/api/repos")
def list_repos() -> list[dict]:
    return store.list_repos()


@app.get("/api/repos/{repo_id}")
def get_repo(repo_id: str) -> dict:
    return _repo_or_404(repo_id)


@app.delete("/api/repos/{repo_id}")
def delete_repo(repo_id: str) -> dict:
    _repo_or_404(repo_id)
    if not store.delete_repo(repo_id):
        raise HTTPException(500, "Could not delete repository")
    return {"deleted": repo_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Unknown job")
    return job


# --------------------------------------------------------------- ingestion ----
def _name_from_url(url: str) -> str:
    last = url.rstrip("/").split("/")[-1]
    return last[:-4] if last.endswith(".git") else (last or "repo")


def _finish_analysis(repo_id: str, repo_dir: Path, job_id: str, source: str,
                     url: Optional[str], started: float) -> str:
    """Index the history and publish the registry entry.

    The metric cache is the expensive artifact, so a failure here keeps the
    checkout on disk and flags the entry as `error` instead of deleting it.
    """
    def cb(frac: float, msg: str) -> None:
        store.update_job(job_id, progress=0.35 + 0.65 * frac, phase="analyzing",
                         message=msg)

    try:
        data = analyze_history(repo_dir, cb)
        data.save(store.analysis_path(repo_id))
    except Exception as exc:
        meta = store.repo_meta(repo_id) or {}
        meta.update({"status": "error", "error": str(exc)[:400]})
        store.write_meta(repo_id, meta)
        raise
    store.put_data(repo_id, data)
    authors = M.authors_payload(data, MergeConfig())
    head_idx = data.resolve_ref("HEAD")
    store.write_meta(repo_id, {
        "name": repo_dir.name,
        "source": source,
        "url": url,
        "status": "ready",
        "head": data.head,
        "created": started,
        "analyzed_in": round(time.time() - started, 2),
        "stats": {
            "commits": len(head_idx),
            "authors": len(authors),
            "files": len(data.files),
            "changes": sum(len(v) for v in data.rows_by_commit.values()),
        },
    })
    return repo_id


@app.post("/api/repos/clone")
def clone_repo(body: CloneRequest) -> dict:
    url = body.url.strip()
    if not url or any(ch in url for ch in ";|&`$") and not url.startswith(("git@", "ssh://")):
        raise HTTPException(400, "Invalid repository URL")
    if not (url.startswith(("http://", "https://", "git://", "ssh://")) or url.startswith("git@")):
        raise HTTPException(400, "URL must start with http(s)://, git://, ssh:// or git@")

    repo_id = store.unique_repo_id(_name_from_url(url))
    repo_dir = store.repo_dir(repo_id)
    started = time.time()
    store.write_meta(repo_id, {"name": repo_id, "source": "clone", "url": url,
                               "status": "cloning", "created": started})
    job = store.new_job("clone", f"Cloning {url}")

    def work() -> str:
        def cb(frac: float, msg: str) -> None:
            store.update_job(job["id"], progress=frac * 0.35, phase="cloning", message=msg)

        try:
            clone_url(url, repo_dir, cb)
        except Exception:
            store.delete_repo(repo_id)  # nothing usable left behind
            raise
        return _finish_analysis(repo_id, repo_dir, job["id"], "clone", url, started)

    store.run_job(job, work)
    return {"job_id": job["id"], "repo_id": repo_id}


@app.post("/api/repos/upload")
async def upload_zip(file: UploadFile = File(...)) -> dict:
    name = (file.filename or "repo.zip").rsplit("/", 1)[-1]
    if not name.lower().endswith((".zip", ".whl", ".gz", ".tgz")):
        raise HTTPException(400, "Please upload a .zip archive of the repository "
                                "(including its .git directory)")
    stem = name[:-4] if name.lower().endswith(".zip") else name.rsplit(".", 1)[0]
    repo_id = store.unique_repo_id(stem)
    started = time.time()
    store.write_meta(repo_id, {"name": repo_id, "source": "zip", "url": None,
                               "status": "uploading", "created": started})
    job = store.new_job("zip", "Receiving upload")

    zip_path = UPLOADS_DIR / f"{repo_id}.zip"
    total = int(file.headers.get("content-length") or 0)
    written = 0
    with open(zip_path, "wb") as fh:
        while chunk := await file.read(1 << 20):
            fh.write(chunk)
            written += len(chunk)
            if total:
                store.update_job(job["id"], progress=0.95 * written / total,
                                 phase="uploading",
                                 message=f"Received {written / 1e6:.1f} / {total / 1e6:.1f} MB")

    def work() -> str:
        repo_dir = store.repo_dir(repo_id)

        def cb(frac: float, msg: str) -> None:
            store.update_job(job["id"], progress=0.05 + 0.3 * frac, phase="extracting",
                             message=msg)

        try:
            extract_zip(zip_path, repo_dir, cb)
            return _finish_analysis(repo_id, repo_dir, job["id"], "zip", None, started)
        finally:
            zip_path.unlink(missing_ok=True)

    store.run_job(job, work)
    return {"job_id": job["id"], "repo_id": repo_id}


# ------------------------------------------------------------- repositories ----
@app.get("/api/repos/{repo_id}/authors")
def repo_authors(repo_id: str) -> list[dict]:
    _repo_or_404(repo_id)
    data = _data_or_500(repo_id)
    return M.authors_payload(data, _merge(repo_id))


@app.get("/api/repos/{repo_id}/merge")
def get_merge(repo_id: str) -> dict:
    _repo_or_404(repo_id)
    return {"groups": _merge(repo_id).groups}


@app.post("/api/repos/{repo_id}/merge")
def set_merge(repo_id: str, body: MergeRequest = Body(...)) -> dict:
    _repo_or_404(repo_id)
    groups = [list(dict.fromkeys(g)) for g in body.groups
              if isinstance(g, list) and len(g) >= 2 and all(str(e).strip() for e in g)]
    cfg = MergeConfig(groups)
    cfg.save(store.merge_path(repo_id))
    return {"groups": cfg.groups}


@app.get("/api/repos/{repo_id}/tree")
def repo_tree(repo_id: str, path: str = Query("", description="directory path")) -> dict:
    _repo_or_404(repo_id)
    data = _data_or_500(repo_id)
    d = (path or "").strip().strip("/")
    if d and d not in data.dirs:
        raise HTTPException(404, f"Unknown directory: {d!r}")
    prefix = f"{d}/" if d else ""
    children: dict[str, str] = {}
    for f in data.files:
        if not f.startswith(prefix):
            continue
        rel = f[len(prefix):]
        seg, rest = (rel.split("/", 1) + [""])[:2] if "/" in rel else (rel, "")
        children[seg] = "directory" if rest else "file"
    items = [
        {"name": name, "kind": kind, "path": f"{prefix}{name}"}
        for name, kind in sorted(children.items(), key=lambda kv: (kv[1] == "file", kv[0]))
    ]
    breadcrumb = [{"name": p.split("/")[-1], "path": p}
                  for p in (("/".join(d.split("/")[:i]) for i in range(1, len(d.split("/")) + 1))
                            if d else [])]
    return {"path": d or "/", "parent": "/".join(d.split("/")[:-1]) if d else None,
            "breadcrumb": breadcrumb, "items": items}


@app.get("/api/repos/{repo_id}/commits")
def repo_commits(
    repo_id: str,
    search: str = "",
    author: Optional[str] = None,
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    ref: str = "HEAD",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    _repo_or_404(repo_id)
    data = _data_or_500(repo_id)
    merge = _merge(repo_id)
    try:
        return M.search_commits(
            data, query=search,
            authors=[author] if author else None,
            from_ts=from_ts, to_ts=to_ts, ref=ref or "HEAD",
            limit=limit, offset=offset, merge=merge,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


# ----------------------------------------------------------------- metrics ----
@app.post("/api/repos/{repo_id}/metrics")
def repo_metrics(repo_id: str, body: Filters = Body(...)) -> dict:
    _repo_or_404(repo_id)
    data = _data_or_500(repo_id)
    try:
        result = M.compute_metrics(data, _merge(repo_id), **_filters(body))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if result["object"]["kind"] == "unknown":
        raise HTTPException(404, f"Unknown file or directory: {body.object_path!r}")
    return result


@app.post("/api/repos/{repo_id}/breakdown")
def repo_breakdown(repo_id: str, body: BreakdownRequest = Body(...)) -> dict:
    _repo_or_404(repo_id)
    if body.dimension not in ("child", "file", "author", "month"):
        raise HTTPException(400, "dimension must be child | file | author | month")
    data = _data_or_500(repo_id)
    try:
        result = M.compute_breakdown(data, _merge(repo_id), body.dimension,
                                     **_filters(body))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if result["object"]["kind"] == "unknown":
        raise HTTPException(404, f"Unknown file or directory: {body.object_path!r}")
    return result


@app.get("/api/repos/{repo_id}/refs")
def repo_refs(repo_id: str, search: str = "") -> dict:
    """Named refs (branches/tags) to help pick a reference commit."""
    _repo_or_404(repo_id)
    repo_dir = store.repo_dir(repo_id)
    out = subprocess.run(["git", "-C", str(repo_dir), "for-each-ref",
                          "--format=%(refname)\t%(objectname)", "refs/heads",
                          "refs/tags", "refs/remotes"],
                         capture_output=True, text=True)
    q = search.strip().lower()
    items = []
    for line in out.stdout.splitlines():
        name, _, sha = line.partition("\t")
        if q and q not in name.lower() and not sha.startswith(q):
            continue
        short = name.replace("refs/heads/", "").replace("refs/tags/", "") \
                    .replace("refs/remotes/", "")
        items.append({"name": name, "short": short, "sha": sha})
    return {"items": items[:200]}
