"""Repo registry, background job tracking, in-memory data cache, merge config."""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Optional

from .ingest import RepoData

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
REPOS_DIR = DATA_DIR / "repos"       # one directory per repo: a pristine git checkout
UPLOADS_DIR = DATA_DIR / "uploads"   # incoming zip archives, deleted after extraction
META_DIR = DATA_DIR / "meta"         # <id>.json  repo registry entries
ANALYSIS_DIR = DATA_DIR / "analysis" # <id>.pkl index, <id>.merge.json author merges


def _safe_slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", name.strip().lower()).strip("-.")
    return s[:60] or "repo"


class Store:
    def __init__(self) -> None:
        REPOS_DIR.mkdir(parents=True, exist_ok=True)
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        META_DIR.mkdir(parents=True, exist_ok=True)
        ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)
        self.jobs: dict[str, dict] = {}
        self._jobs_lock = threading.Lock()
        self._data: dict[str, RepoData] = {}
        self._data_lock = threading.Lock()

    # -- jobs -----------------------------------------------------------------
    def new_job(self, kind: str, message: str = "") -> dict:
        job = {
            "id": uuid.uuid4().hex[:12],
            "kind": kind,
            "status": "running",
            "phase": "queued",
            "progress": 0.0,
            "message": message,
            "repo_id": None,
            "error": None,
            "created": time.time(),
        }
        with self._jobs_lock:
            self.jobs[job["id"]] = job
        return job

    def update_job(self, job_id: str, **kw) -> None:
        with self._jobs_lock:
            job = self.jobs.get(job_id)
            if job:
                job.update(kw)

    def get_job(self, job_id: str) -> Optional[dict]:
        with self._jobs_lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None

    def run_job(self, job: dict, work: Callable[[], str]) -> None:
        """Run `work` in a background thread; it returns the new repo id."""

        def runner() -> None:
            try:
                repo_id = work()
                self.update_job(job["id"], status="done", progress=1.0,
                                phase="done", repo_id=repo_id,
                                message="Repository ready")
            except Exception as exc:  # surfaced to the UI
                self.update_job(job["id"], status="error", phase="error",
                                error=str(exc)[:600])

        threading.Thread(target=runner, daemon=True).start()

    # -- repos ----------------------------------------------------------------
    def repo_dir(self, repo_id: str) -> Path:
        """The git working copy itself — kept free of tool files so `git` stays pure."""
        return REPOS_DIR / repo_id

    def meta_path(self, repo_id: str) -> Path:
        return META_DIR / f"{repo_id}.json"

    def analysis_path(self, repo_id: str) -> Path:
        return ANALYSIS_DIR / f"{repo_id}.pkl"

    def merge_path(self, repo_id: str) -> Path:
        return ANALYSIS_DIR / f"{repo_id}.merge.json"

    def repo_meta(self, repo_id: str) -> Optional[dict]:
        p = self.meta_path(repo_id)
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text())
        except Exception:
            return None

    def write_meta(self, repo_id: str, meta: dict) -> None:
        META_DIR.mkdir(parents=True, exist_ok=True)
        # Atomic: a crash mid-write must not leave a half-readable registry entry.
        tmp = self.meta_path(repo_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, indent=2))
        tmp.replace(self.meta_path(repo_id))

    def list_repos(self) -> list[dict]:
        out = []
        if META_DIR.exists():
            for p in sorted(META_DIR.glob("*.json"),
                            key=lambda p: p.stat().st_mtime, reverse=True):
                try:
                    meta = json.loads(p.read_text())
                except Exception:
                    continue
                meta["id"] = p.stem
                out.append(meta)
        return out

    def unique_repo_id(self, name: str) -> str:
        base = _safe_slug(name)
        candidate, n = base, 2
        while self.meta_path(candidate).exists() or (REPOS_DIR / candidate).exists():
            candidate = f"{base}-{n}"
            n += 1
        return candidate

    def delete_repo(self, repo_id: str) -> bool:
        d = self.repo_dir(repo_id)
        if d.exists() and not d.resolve().is_relative_to(REPOS_DIR.resolve()):
            return False
        with self._data_lock:
            self._data.pop(repo_id, None)
        shutil.rmtree(d, ignore_errors=True)
        for p in (self.meta_path(repo_id), self.analysis_path(repo_id),
                  self.merge_path(repo_id)):
            p.unlink(missing_ok=True)
        return True

    # -- analysis data ----------------------------------------------------------
    def get_data(self, repo_id: str) -> RepoData:
        with self._data_lock:
            cached = self._data.get(repo_id)
        if cached is not None:
            return cached
        cache = self.analysis_path(repo_id)
        if not cache.exists():
            raise FileNotFoundError(f"Repository {repo_id!r} has not been analyzed yet")
        data = RepoData.load(cache, self.repo_dir(repo_id))
        with self._data_lock:
            self._data[repo_id] = data
        return data

    def put_data(self, repo_id: str, data: RepoData) -> None:
        with self._data_lock:
            self._data[repo_id] = data


store = Store()


class MergeConfig:
    """Manual author-merge groups over author ids ("Name <email>").

    The first entry of a group is the canonical id the others merge into.
    """

    def __init__(self, groups: Optional[list[list[str]]] = None) -> None:
        self.groups: list[list[str]] = groups or []

    @staticmethod
    def load(path: Path) -> "MergeConfig":
        p = Path(path)
        if not p.exists():
            return MergeConfig()
        try:
            raw = json.loads(p.read_text()).get("groups", [])
            groups = [
                list(dict.fromkeys(g))
                for g in raw
                if isinstance(g, list) and len(g) >= 2
                and all(isinstance(e, str) and e.strip() for e in g)
            ]
            return MergeConfig(groups)
        except Exception:
            return MergeConfig()

    def save(self, path: Path) -> None:
        Path(path).write_text(json.dumps({"groups": self.groups}, indent=2))

    def canon_map(self) -> dict[str, str]:
        if not self.groups:
            return {}
        if not hasattr(self, "_canon"):
            m: dict[str, str] = {}
            for g in self.groups:
                for e in g[1:]:
                    m[e] = g[0]
            self._canon = m
        return self._canon

    def effective(self, author: str) -> str:
        return self.canon_map().get(author, author)
