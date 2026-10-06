# RAT — Repo Analysis Tool

A web dashboard that ingests git repositories and reports churn/growth/ownership
metrics per **file**, **directory**, **repository**, **commit set** and **author**,
with filtering by repository, author, path, time period and an explicit commit list.

Backend: Python 3.12 + FastAPI (`backend/`) — a single-pass `git log` indexer and a
metric engine. Frontend: Next.js 14 (App Router, client components) + Recharts (`frontend/`).
Git is read through the `git` CLI (no gitpython), so history semantics — including each
repository's own `.mailmap` — are exactly git's.

---

## Running it

Requirements: `git` 2.25+, Python 3.10+, Node 18+.

```bash
./start.sh                 # installs deps if needed, then serves both processes
```

Open **http://127.0.0.1:3000**. The backend API is on port 8000 and is proxied by Next.js
under `/api/*`, so the dashboard needs no CORS setup or extra configuration.

`./start.sh --prod` builds the optimized Next.js bundle first (faster UI, slower start).
Ports can be overridden: `API_PORT=8080 UI_PORT=3001 ./start.sh`.

Manual equivalent:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000 &
cd frontend && npm install && npm run dev -- -p 3000
```

### First use

1. Paste a clone URL (e.g. `https://github.com/DaveGamble/cJSON.git`) or upload a zip that
   contains the repository's `.git` directory.
2. Watch the job progress bar; when the repo turns green the index is cached permanently.
3. Pick the repository, then narrow it with the filter bar and read the metric cards and
   the breakdown tables. Click a directory in the *Immediate children* table to drill in.

### Dashboard features

**Filter bar** — all filters are live and combine:

| Filter | How |
|---|---|
| Path | Type a file or directory path — metrics update 600 ms after you stop typing, or press Enter / *Apply path*. Click *Browse…* to navigate the file tree. |
| Ref | Any branch, tag, or commit sha — autocomplete dropdown lists all refs. |
| Authors | Always-visible search input; tick one or more authors to restrict H. |
| Time window | `from` / `to` date inputs or one-click presets: 30d / 90d / 1y / All. |
| Commit list | *Pick commits* opens a paginated, searchable commit picker. |

Active filters appear as dismissible chips under the filter bar. The `|H|` chip in the
header shows the current commit-set size.

**Author merge** — *Merge authors* opens a modal to group identities that mailmap did not
automatically unify (e.g. same person with different email addresses). Groups persist per
repository and are applied to every subsequent metric query.

**Breakdown tabs** — four views of the same filtered metric set:

| Tab | Contents |
|---|---|
| Immediate children | Sortable table + top-objects-by-churn bar chart |
| Files | Flat file list with churn heat bar |
| Authors | Ownership % donut + sortable author table |
| By month | Commit-activity line chart + monthly churn bar chart + cumulative growth area chart |

All chart and table sections are collapsible.

---

## Architecture

```
backend/app/ingest.py    git -> in-memory index (clone/extract + one `git log` pass)
backend/app/metrics.py    index -> numbers (commit-set H, object predicates, aggregation)
backend/app/store.py      registry of repos, background job table, data layout, merge groups
backend/app/main.py       FastAPI routes: ingestion, filtering, metrics, breakdowns
frontend/lib/             typed API client + formatting helpers
frontend/components/      RepoPanel, FilterBar, MetricCards, BreakdownTable, charts
frontend/app/             App Router pages (single dashboard page, client-rendered)
```

`backend/data/` (git-ignored) holds every artifact, keyed by a slug id such as `cjson`:

| Path | Contents |
|---|---|
| `repos/<id>/` | the clone — a pristine working tree, nothing else written inside it |
| `meta/<id>.json` | registry entry: source, status, HEAD sha, headline stats |
| `analysis/<id>.pkl` | the index cache: commits, per-commit changed-line rows |
| `analysis/<id>.merge.json` | manual author-merge groups for that repository |

### The index

Analysis is one subprocess pass:

```
git log --branches --tags --remotes --no-merges --numstat --find-renames=50% \
        --format=%x01%H%x1f%aN%x1f%aE%x1f%ct%x1f%s
```

which yields, per commit, a list of `(path, added, removed)` rows plus the set of touched
paths. Everything else is computed from that in memory:

* `files` / `dirs` — the object universe, used to answer "is this path a file or a directory?"
* `hash_idx` + a sorted hash list — abbreviated hashes and full hashes both resolve in O(log n)
* per-`ref` commit-set caches, so re-asking about the same ref is free

Re-asking a metric question never touches git again: it filters a set of integer commit
indices and sums small tuples. git.git (82,426 commits) indexes in ~30 s and is then
interactive; cJSON indexes in 0.3 s, redis in ~12 s.

### Semantics (the choices that decide the numbers)

* **Binary files are not measured.** `--numstat` reports `- -` for them; those entries are
  dropped entirely, so binary paths do not appear as objects at all.
* **Renames are detected at 50% similarity** and their changes are attributed to the **new
  path**. Both brace form (`a/{old => new}b`) and plain (`old => new`) are parsed, and empty
  segments produced by a move out of a directory are collapsed (`deps/jemalloc//config.guess`
  → `deps/jemalloc/config.guess`). A rename registers *both* paths as objects, since both
  existed in history; only the new one carries the lines.
* **Deletions are recorded on the deleted file's path** as removed lines — the diff already
  expresses this, so no special case is needed once paths are keyed correctly.
* **`H` = the non-merge commits reachable from the reference commit** (default `HEAD`,
  overridable by any ref, tag or sha). Branch and tag tips are all indexed, so historic refs
  are queryable; every object's denominator is `|H|`.
* Formulas, exactly as specified:
  `modification_frequency = modifications / |H|`, `churn_rate = churn / |H|`,
  `ownership = author churn / total churn` (for that object).
  `modifications` counts commits with non-zero churn on the object, so an empty commit
  inflates `|H|` but contributes no modification.
* **Author identity is `"Name <email>"` with the repository's `.mailmap` applied** (git's
  `%aN`/`%aE`), which is why e.g. `Alanscut <wp_scut@163.com>` and
  `Alan Wang <wp_scut@163.com>` stay distinct rows in git.git while mailmapped duplicates
  collapse automatically. Manual merging layers on top of mailmap via merge groups.

### Correctness evidence

`scripts/compare_reference.py` (offline) and `scripts/e2e_api_test.py` (over HTTP, against a
running backend) both compare against the reference metric exports. All three test
repositories reproduce exactly:

```
cJSON   objects 291/291   rows 983/983      (0.3 s index)
redis   objects 3068/3068 rows 18301/18301  (12.2 s index)
git     objects 7615/7615 rows 62600/62600  (29.2 s index)
```

```bash
.venv/bin/python scripts/e2e_api_test.py --csv /path/to/cJSON_6d9f2443ab07.csv --all-objects
```

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | git version, repo count |
| GET | `/api/repos` · `/api/repos/{id}` | registry + stats |
| POST | `/api/repos/clone` | deep clone a URL (background job) |
| POST | `/api/repos/upload` | zip containing `.git` (background job) |
| GET | `/api/jobs/{id}` | progress polling: phase, fraction, message |
| DELETE | `/api/repos/{id}` | drop clone, cache and merge groups |
| POST | `/api/repos/{id}/metrics` | one object's metrics under the filters |
| POST | `/api/repos/{id}/breakdown` | same, split by `child`/`file`/`author`/`month` |
| GET | `/api/repos/{id}/tree?path=` | path browser for the object picker |
| GET | `/api/repos/{id}/commits` | commit search: query, author, period, paging |
| GET | `/api/repos/{id}/refs?search=` | branch/tag/sha candidates for `ref` |
| GET · POST | `/api/repos/{id}/merge` | read/update manual author-merge groups |
| GET | `/api/repos/{id}/authors` | author ids, commit counts, merged-from members |

Filter payload shared by `metrics`/`breakdown`:

```json
{ "ref": "HEAD", "object_path": "src", "authors": ["A <a@b>"],
  "from_ts": 1400000000, "to_ts": 1500000000, "commit_hashes": ["6d9f2443"] }
```

`object_path` selects the measured object (empty = repository root); the rest narrow `H`.
`to_ts` is exclusive, matching a `[from, to)` window.
