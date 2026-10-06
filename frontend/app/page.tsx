"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { EMPTY_FILTERS, type Author, type Breakdown, type CommitRow, type Filters, type Metrics, type Repo } from "../lib/types";
import RepoPanel from "../components/RepoPanel";
import FilterBar from "../components/FilterBar";
import MetricCards from "../components/MetricCards";
import BreakdownTable from "../components/BreakdownTable";
import MergePanel from "../components/MergePanel";
import MonthChart from "../components/MonthChart";
import OwnershipChart from "../components/OwnershipChart";
import TopChurnChart from "../components/TopChurnChart";
import GrowthChart from "../components/GrowthChart";
import Collapsible from "../components/Collapsible";
import { fmtDateTime } from "../lib/format";

const TABS: { key: string; title: string; ownership?: boolean }[] = [
  { key: "child", title: "Immediate children" },
  { key: "file", title: "Every file" },
  { key: "author", title: "Authors", ownership: true },
  { key: "month", title: "By month" },
];

/** Modal for manually picking a list of commits to narrow the commit set H. */
function CommitPicker({
  repoId,
  filters,
  selected,
  onApply,
  onClose,
}: {
  repoId: string;
  filters: Filters;
  selected: string[];
  onApply: (hashes: string[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CommitRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [page, setPage] = useState(0);
  const PAGE = 50;

  const load = useCallback(async (q: string, offset: number) => {
    setBusy(true);
    try {
      const res = await api.commits(repoId, {
        ref: filters.ref || "HEAD",
        search: q,
        limit: PAGE,
        offset,
      });
      if (offset === 0) setItems(res.items);
      else setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  }, [repoId, filters.ref]);

  useEffect(() => { load(query, 0); setPage(0); }, [query, load]);

  function toggle(hash: string) {
    setPicked((s) => {
      const n = new Set(s);
      n.has(hash) ? n.delete(hash) : n.add(hash);
      return n;
    });
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
               display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="panel"
        style={{ width: 680, maxWidth: "95vw", maxHeight: "85vh", overflow: "auto",
                 display: "flex", flexDirection: "column", gap: 10, margin: 0 }}
      >
        <div className="row">
          <h3 style={{ margin: 0, flex: 1 }}>Pick commits ({picked.size} selected)</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Check commits to restrict H to only those commits. Leave empty to use all of H̄.
        </p>
        <input
          className="field"
          placeholder="search by subject, author or hash…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          {items.map((c) => (
            <label key={c.hash} className="row"
                   style={{ padding: "4px 2px", gap: 8, cursor: "pointer", alignItems: "flex-start" }}>
              <input type="checkbox" checked={picked.has(c.hash)} onChange={() => toggle(c.hash)} />
              <span className="small" style={{ fontFamily: "monospace", flexShrink: 0, color: "var(--accent)" }}>
                {c.hash.slice(0, 9)}
              </span>
              <span className="small muted" style={{ flexShrink: 0 }}>
                {fmtDateTime(c.committer_ts)}
              </span>
              <span className="small grow"
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.subject}
              </span>
              <span className="small muted"
                    style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis",
                             maxWidth: 140, whiteSpace: "nowrap" }}>
                {c.author.split(" <")[0]}
              </span>
            </label>
          ))}
          {items.length < total && (
            <button
              className="btn small"
              disabled={busy}
              onClick={() => { const next = page + 1; setPage(next); load(query, next * PAGE); }}
              style={{ marginTop: 6 }}
            >
              {busy ? "loading…" : `Load more (${total - items.length} remaining)`}
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn primary"
            onClick={() => onApply([...picked])}
            disabled={picked.size === 0}
          >
            Apply {picked.size > 0 ? `${picked.size} commits` : ""}
          </button>
          {picked.size > 0 && (
            <button className="btn" onClick={() => setPicked(new Set())}>Clear selection</button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <span className="small muted grow" style={{ textAlign: "right" }}>
            {total.toLocaleString()} commits in H̄
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [authors, setAuthors] = useState<Author[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [tab, setTab] = useState("child");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [showCommitPicker, setShowCommitPicker] = useState(false);
  const seq = useRef(0);

  const repo = repos.find((r) => r.id === selectedId) || null;

  const refreshRepos = useCallback(async () => {
    try {
      const list = await api.repos();
      setRepos(list);
      setSelectedId((cur) => {
        // Keep current selection if still ready; otherwise restore from localStorage
        // or auto-pick the first ready repo.
        if (cur && list.some((r) => r.id === cur && r.status === "ready")) return cur;
        const saved = typeof window !== "undefined" ? localStorage.getItem("rat_repo") : null;
        const savedReady = saved && list.some((r) => r.id === saved && r.status === "ready");
        if (savedReady) return saved!;
        const firstReady = list.find((r) => r.status === "ready");
        return firstReady ? firstReady.id : null;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { refreshRepos(); }, [refreshRepos]);

  useEffect(() => {
    setAuthors([]);
    if (!selectedId) return;
    let live = true;
    api.authors(selectedId)
      .then((a) => live && setAuthors(a))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setMetrics(null); setBreakdown(null); return; }
    const mySeq = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const [m, b] = await Promise.all([
          api.metrics(selectedId, filters),
          api.breakdown(selectedId, filters, tab),
        ]);
        if (mySeq !== seq.current) return;
        setMetrics(m);
        setBreakdown(b);
        setError(null);
      } catch (e) {
        if (mySeq !== seq.current) return;
        setMetrics(null); setBreakdown(null);
        setError((e as Error).message);
      } finally {
        if (mySeq === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [selectedId, filters, tab]);

  function patch(p: Partial<Filters>) { setFilters((f) => ({ ...f, ...p })); }
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">RAT <span className="muted">· Repo Analysis Tool</span></div>
        <RepoPanel
          repos={repos}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setFilters(EMPTY_FILTERS);
            try { localStorage.setItem("rat_repo", id); } catch { /* safari private */ }
          }}
          onRefresh={refreshRepos}
        />
      </aside>

      <main className="main">
        {!repo ? (
          <div className="panel">
            <h3>No repository selected</h3>
            <p className="muted">
              Clone a repository URL or upload a zip archive containing <code>.git</code> from the
              left panel. Analysis runs in the background and is cached permanently afterwards.
            </p>
          </div>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 10 }}>
              <h2 style={{ margin: 0 }}>{repo.name}</h2>
              <span className="small muted">
                {repo.head ? repo.head.slice(0, 10) : ""} · {repo.source}
                {repo.analyzed_in ? ` · indexed in ${repo.analyzed_in.toFixed(1)}s` : ""}
              </span>
              {busy && <span className="spinner" title="recomputing" />}
              <div style={{ marginLeft: "auto" }}>
                <button className="btn small" onClick={() => setShowMerge(true)}
                        title="Merge author identities (mailmap + manual groups)">
                  Merge authors
                </button>
                <button className="btn small" style={{ marginLeft: 6 }}
                        onClick={() => setShowCommitPicker(true)}
                        title="Select a specific set of commits to scope H">
                  Pick commits{filters.commit_hashes.length ? ` (${filters.commit_hashes.length})` : ""}
                </button>
              </div>
            </div>

            <FilterBar filters={filters} authors={authors} repoId={selectedId} onChange={patch}
                       onClear={() => setFilters({ ...EMPTY_FILTERS, ref: filters.ref })} />

            <div style={{ marginTop: 16 }}>
              <div className="section-title">
                {metrics ? `${metrics.object.kind}: ${metrics.object.path || "/"}` : "Metrics"}
              </div>
              <MetricCards m={metrics} />
            </div>

            <div className="tabs">
              {TABS.map((t) => (
                <button key={t.key} className={`tab ${t.key === tab ? "active" : ""}`}
                        onClick={() => setTab(t.key)}>
                  {t.title}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              {breakdown ? (
                tab === "month" ? (
                  <>
                    <Collapsible title="Churn by month">
                      <MonthChart items={breakdown.items} />
                    </Collapsible>
                    <Collapsible title="Cumulative growth" defaultOpen={false}>
                      <GrowthChart items={breakdown.items} />
                    </Collapsible>
                    <Collapsible title="Month breakdown table">
                      <BreakdownTable items={breakdown.items} showOwnership={false}
                                     emptyLabel="Nothing changed in this period." />
                    </Collapsible>
                  </>
                ) : tab === "author" ? (
                  <>
                    <Collapsible title="Ownership distribution">
                      <OwnershipChart items={breakdown.items} />
                    </Collapsible>
                    <Collapsible title="Author breakdown table">
                      <BreakdownTable
                        items={breakdown.items}
                        showOwnership
                        emptyLabel="No authors found for these filters."
                      />
                    </Collapsible>
                  </>
                ) : (
                  <>
                    <Collapsible title={tab === "file" ? "Top files by churn" : "Top objects by churn"}>
                      <TopChurnChart
                        items={breakdown.items}
                        label={tab === "file" ? "Top files by churn" : "Top objects by churn"}
                      />
                    </Collapsible>
                    <Collapsible title="Breakdown table">
                      <BreakdownTable
                        items={breakdown.items}
                        showOwnership={false}
                        onPickPath={
                          tab === "child" || tab === "file"
                            ? (p) => { setFilters((f) => ({ ...f, object_path: p })); setTab("child"); }
                            : undefined
                        }
                        emptyLabel="Nothing changed under these filters."
                      />
                    </Collapsible>
                  </>
                )
              ) : (
                <div className="muted small">{busy ? "computing…" : "no data"}</div>
              )}
            </div>
          </>
        )}
      </main>

      {error && (
        <div className="toast">
          <div className="row" style={{ gap: 8 }}>
            <span style={{ color: "var(--red)" }}>✕</span>
            <span className="grow">{error}</span>
            <button className="btn small" onClick={() => setError(null)}>dismiss</button>
          </div>
        </div>
      )}

      {showMerge && selectedId && (
        <MergePanel
          repoId={selectedId}
          onClose={() => { setShowMerge(false); /* reload authors after merge */ api.authors(selectedId).then(setAuthors).catch(() => {}); }}
        />
      )}

      {showCommitPicker && selectedId && (
        <CommitPicker
          repoId={selectedId}
          filters={filters}
          selected={filters.commit_hashes}
          onApply={(hashes) => { patch({ commit_hashes: hashes }); setShowCommitPicker(false); }}
          onClose={() => setShowCommitPicker(false)}
        />
      )}
    </div>
  );
}
