"""Repository ingestion: zip extraction, git clone and history analysis.

The whole history is parsed in a single `git log --numstat` pass. Each
non-merge commit gets a row list of (path, added, removed) tuples; binary
files (numstat "-") and pure renames (0/0) are skipped. Rename entries are
normalised to their new path, per the metric spec.
"""
from __future__ import annotations

import json
import os
import pickle
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Callable, Optional

ProgressCb = Optional[Callable[[float, str], None]]

CACHE_VERSION = 5
MAX_ZIP_BYTES = 4 * 1024**3
MAX_ZIP_FILES = 250_000


def _git(repo_dir: Path, args: list[str]) -> str:
    out = subprocess.run(
        ["git", "-C", str(repo_dir)] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
    )
    if out.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {out.stderr.strip()[-400:]}")
    return out.stdout


def _unquote_path(s: str) -> str:
    """Undo git's C-style path quoting (core.quotePath)."""
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        body = s[1:-1]
        out = bytearray()
        i = 0
        while i < len(body):
            c = body[i]
            if c == "\\" and i + 1 < len(body):
                nxt = body[i + 1]
                simple = {"n": 10, "t": 9, "r": 13, '"': 34, "\\": 92, "a": 7, "b": 8, "f": 12, "v": 11}
                if nxt in simple:
                    out.append(simple[nxt])
                    i += 2
                    continue
                if nxt.isdigit():  # octal escape \NNN (utf-8 bytes)
                    oct_digits = body[i + 1 : i + 4]
                    out.append(int(oct_digits, 8) & 0xFF)
                    i += 4
                    continue
            out.extend(c.encode("utf-8", "replace"))
            i += 1
        return out.decode("utf-8", "replace")
    return s


_RENAME_BRACE = re.compile(r"^(.*?)\{(.*) => (.*)\}(.*)$")


def _clean_path(path: str) -> str:
    """Collapse empty/'.' segments produced by brace-renames.

    git emits `deps/jemalloc/{build-aux => }/config.guess` when a file moves out
    of a directory; naive expansion yields the bogus `deps/jemalloc//config.guess`.
    """
    return "/".join(seg for seg in path.split("/") if seg not in ("", "."))


def normalize_numstat_path(raw: str) -> tuple[str, str]:
    """Return (old_path, new_path) for a numstat path field.

    They are identical unless the entry is a rename, in which case the new path
    is the one that carries the metrics ("changes are attributed to its new
    path") while both still belong to the object set (h[F] union h[p][F]).
    """
    s = _unquote_path(raw.strip())
    if " => " not in s:
        p = _clean_path(s)
        return p, p
    m = _RENAME_BRACE.match(s)
    if m:
        pre, old_mid, new_mid, post = m.groups()
        old = _clean_path(pre + old_mid + post)
        new = _clean_path(pre + new_mid + post)
    else:
        idx = s.find(" => ")
        old = _clean_path(s[:idx])
        new = _clean_path(s[idx + 4:])
    return old, new


class RepoData:
    """In-memory analysis index for one repository."""

    def __init__(self) -> None:
        # (hash, author name, author email [mailmap-applied], committer ts, subject)
        self.commits: list[tuple[str, str, str, int, str]] = []
        self.rows_by_commit: dict[int, list[tuple[str, int, int]]] = {}
        # every path in each commit's diff, including unmeasured ones
        self.touched_by_commit: dict[int, list[str]] = {}
        self.files: set[str] = set()
        self.dirs: set[str] = set()
        self.hash_idx: dict[str, int] = {}
        self._hashes_sorted: list[str] = []
        self.head: str = ""
        self.repo_dir: Optional[Path] = None
        self._ref_cache: dict[str, set[int]] = {}

    # -- derived structures -------------------------------------------------
    def finalize(self) -> None:
        dirs: set[str] = set()
        for f in self.files:
            parts = f.split("/")
            for i in range(1, len(parts)):
                dirs.add("/".join(parts[:i]))
        self.dirs = dirs
        self.hash_idx = {c[0]: i for i, c in enumerate(self.commits)}
        self._hashes_sorted = sorted(self.hash_idx)

    # -- commit set resolution ---------------------------------------------
    def resolve_ref(self, ref: str) -> set[int]:
        """Indices of non-merge commits reachable from `ref`."""
        ref = (ref or "HEAD").strip() or "HEAD"
        if ref == "HEAD" and self.head and self.head in self._ref_cache:
            return self._ref_cache[self.head]
        if ref in self._ref_cache:
            return self._ref_cache[ref]
        assert self.repo_dir is not None
        try:
            _git(self.repo_dir, ["rev-parse", "--verify", "--quiet", ref])
        except RuntimeError:
            raise ValueError(f"Unknown revision: {ref!r}")
        out = _git(self.repo_dir, ["rev-list", "--no-merges", ref])
        idxs: set[int] = set()
        for h in out.split():
            i = self.hash_idx.get(h)
            if i is not None:
                idxs.add(i)
        self._ref_cache[ref] = idxs
        return idxs

    def resolve_hashes(self, requested: list[str]) -> set[int]:
        """Resolve full or abbreviated commit hashes to indices."""
        found: set[int] = set()
        for req in requested:
            req = req.strip()
            if not req:
                continue
            if req in self.hash_idx:
                found.add(self.hash_idx[req])
                continue
            lo = bisect_left(self._hashes_sorted, req)
            for h in self._hashes_sorted[lo : lo + 64]:
                if h.startswith(req):
                    found.add(self.hash_idx[h])
                else:
                    break
        return found

    # -- persistence ---------------------------------------------------------
    def save(self, path: Path) -> None:
        payload = {
            "version": CACHE_VERSION,
            "commits": self.commits,
            "rows_by_commit": self.rows_by_commit,
            "touched_by_commit": self.touched_by_commit,
            "files": sorted(self.files),
            "head": self.head,
        }
        tmp = path.with_suffix(".tmp")
        with open(tmp, "wb") as fh:
            pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path, repo_dir: Path) -> "RepoData":
        with open(path, "rb") as fh:
            payload = pickle.load(fh)
        if payload.get("version") != CACHE_VERSION:
            raise ValueError("stale cache")
        data = cls()
        data.commits = payload["commits"]
        data.rows_by_commit = payload["rows_by_commit"]
        data.touched_by_commit = payload.get("touched_by_commit", {})
        data.files = set(payload["files"])
        data.head = payload["head"]
        data.repo_dir = repo_dir
        data.finalize()
        return data


from bisect import bisect_left  # noqa: E402  (used by RepoData.resolve_hashes)


def analyze_history(repo_dir: Path, progress_cb: ProgressCb = None) -> RepoData:
    """Parse the full git history into a RepoData index."""
    total = 0
    try:
        total = int(_git(repo_dir, ["rev-list", "--count", "--no-merges",
                                    "--branches", "--tags", "--remotes"]).strip() or 0)
    except RuntimeError:
        pass

    def report(frac: float, msg: str) -> None:
        if progress_cb:
            progress_cb(frac, msg)

    report(0.02, "Counting commits")
    data = RepoData()
    data.repo_dir = repo_dir
    fmt = "%x01%H%x1f%aN%x1f%aE%x1f%ct%x1f%s"
    cmd = [
        "git", "-C", str(repo_dir), "log",
        "--branches", "--tags", "--remotes",
        "--no-merges",
        "--numstat",
        "--find-renames=50%",
        f"--format={fmt}",
    ]
    with tempfile.TemporaryFile() as errf:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errf,
                                text=True, errors="replace", bufsize=1 << 20)
        assert proc.stdout is not None
        idx = -1
        rows = 0
        for line in proc.stdout:
            if line.startswith("\x01"):
                idx += 1
                parts = line[1:].rstrip("\n").split("\x1f")
                h = parts[0]
                name = parts[1] if len(parts) > 1 else "unknown"
                email = parts[2] if len(parts) > 2 else "unknown"
                ts = 0
                if len(parts) > 3 and parts[3].isdigit():
                    ts = int(parts[3])
                subj = parts[4] if len(parts) > 4 else ""
                data.commits.append((h, name, email, ts, subj))
                data.hash_idx[h] = idx
            elif "\t" in line:
                cols = line.rstrip("\n").split("\t")
                if len(cols) < 3:
                    continue
                a_s, r_s = cols[0], cols[1]
                path_s = "\t".join(cols[2:])
                if a_s == "-" or r_s == "-":
                    # Binary (or submodule) files are not measured at all:
                    # git reports "-" and they never become objects.
                    continue
                old_path, new_path = normalize_numstat_path(path_s)
                for p in {old_path, new_path}:
                    if not p or p.endswith("/"):
                        continue
                    # Every diff path belongs to H[F] (renames contribute both
                    # the old and the new path), even when it changes no lines
                    # (pure rename, mode-only change) -> an all-zero object.
                    data.files.add(p)
                    touched = data.touched_by_commit.setdefault(idx, [])
                    if p not in touched:
                        touched.append(p)
                try:
                    added, removed = int(a_s), int(r_s)
                except ValueError:
                    continue
                if added == 0 and removed == 0:  # pure rename / mode change
                    continue
                data.rows_by_commit.setdefault(idx, []).append((new_path, added, removed))
                rows += 1
            if total and idx >= 0 and idx % 512 == 0:
                report(0.02 + 0.93 * idx / total, f"Parsing commits {idx}/{total}")
        proc.wait()
        if proc.returncode != 0:
            errf.seek(0)
            msg = errf.read().decode("utf-8", "replace").strip()[-400:]
            raise RuntimeError(f"git log failed: {msg}")

    data.head = _git(repo_dir, ["rev-parse", "HEAD"]).strip()
    data.finalize()
    report(1.0, f"Indexed {len(data.commits)} commits, {rows} file changes")
    return data


def clone_url(url: str, dest: Path, progress_cb: ProgressCb = None) -> None:
    """Deep-clone a remote repository with progress reporting."""
    if progress_cb:
        progress_cb(0.02, f"Cloning {url}")

    def report(line: str) -> None:
        m = re.search(r"(Receiving objects|Resolving deltas):\s+(\d+)%", line)
        if m and progress_cb:
            frac = 0.02 + 0.58 * int(m.group(2)) / 100.0
            progress_cb(frac, line.strip()[:120])

    proc = subprocess.Popen(["git", "clone", url, str(dest)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE, text=True, errors="replace",
                            # A private URL must fail fast, not block the worker
                            # thread on an interactive credentials prompt.
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    assert proc.stderr is not None
    tail: list[str] = []
    for line in proc.stderr:
        report(line)
        # Progress uses \r, so the last chunk of a line is the interesting one.
        snippet = line.rstrip().split("\r")[-1].strip()
        if snippet:
            tail.append(snippet[-200:])
            del tail[:-4]
    rc = proc.wait()
    if rc != 0:
        shutil.rmtree(dest, ignore_errors=True)
        detail = "; ".join(tail[-2:]) or f"git exited with status {rc}"
        raise RuntimeError(f"git clone failed: {detail} "
                          "(public repos only — the tool never prompts for credentials)")


def extract_zip(zip_path: Path, dest: Path, progress_cb: ProgressCb = None) -> None:
    """Safely extract a zipped repository (must contain a .git dir/file)."""
    if progress_cb:
        progress_cb(0.05, "Extracting zip")
    tmp = Path(tempfile.mkdtemp(prefix="rat-zip-", dir=str(dest.parent)))
    try:
        with zipfile.ZipFile(zip_path) as z:
            infos = z.infolist()
            if len(infos) > MAX_ZIP_FILES:
                raise RuntimeError("Zip archive contains too many files.")
            total_unc = sum(i.file_size for i in infos)
            if total_unc > MAX_ZIP_BYTES:
                raise RuntimeError("Zip archive is too large when extracted.")
            done = 0
            for info in infos:
                name = info.filename
                if name.startswith("/") or ".." in Path(name).parts or ":" in name.split("/")[0]:
                    raise RuntimeError(f"Unsafe path in zip: {name!r}")
                target = tmp / name
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out, length=1 << 20)
                done += info.file_size
                if progress_cb and total_unc:
                    progress_cb(0.05 + 0.2 * done / max(total_unc, 1), "Extracting zip")

        root = tmp
        if not (root / ".git").exists():
            children = [c for c in root.iterdir() if c.is_dir()]
            nested = [c for c in children if (c / ".git").exists()]
            if len(nested) == 1:
                root = nested[0]
            else:
                raise RuntimeError(
                    "No .git directory found in the uploaded zip. "
                    "Zip the repository folder including its .git directory."
                )
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(root), str(dest))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # Ensure the worktree matches HEAD so the repo's .mailmap applies.
    try:
        _git(dest, ["rev-parse", "--verify", "--quiet", "HEAD"])
        subprocess.run(["git", "-C", str(dest), "checkout", "-f", "-q", "HEAD"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
    except Exception:
        pass
    if progress_cb:
        progress_cb(0.3, "Zip extracted")
