"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { EMPTY_FILTERS, type Author, type Breakdown, type Filters, type Metrics, type Repo } from "../lib/types";
import RepoPanel from "../components/RepoPanel";
import FilterBar from "../components/FilterBar";
import MetricCards from "../components/MetricCards";
import BreakdownTable from "../components/BreakdownTable";

const TABS: { key: string; title: string; ownership?: boolean }[] = [
  { key: "child", title: "Immediate children" },
  { key: "file", title: "Every file" },
  { key: "author", title: "Authors", ownership: true },
  { key: "month", title: "By month" },
];

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
  const seq = useRef(0);

  const repo = repos.find((r) => r.id === selectedId) || null;

  const refreshRepos = useCallback(async () => {
    try {
      const list = await api.repos();
      setRepos(list);
      setSelectedId((cur) => {
        if (cur && list.some((r) => r.id === cur && r.status === "ready")) return cur;
        const firstReady = list.find((r) => r.status === "ready");
        return firstReady ? firstReady.id : null;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refreshRepos();
  }, [refreshRepos]);

  useEffect(() => {
    setAuthors([]);
    if (!selectedId) return;
    let live = true;
    api.authors(selectedId)
      .then((a) => live && setAuthors(a))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [selectedId]);

  // Recompute on any filter change, debounced so typing a path is not costly.
  useEffect(() => {
    if (!selectedId) {
      setMetrics(null);
      setBreakdown(null);
      return;
    }
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
        setMetrics(null);
        setBreakdown(null);
        setError((e as Error).message);
      } finally {
        if (mySeq === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [selectedId, filters, tab]);

  function patch(p: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...p }));
  }

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          RAT <span className="muted">· Repo Analysis Tool</span>
        </div>
        <RepoPanel
          repos={repos}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setFilters(EMPTY_FILTERS);
          }}
          onRefresh={refreshRepos}
        />
      </aside>

      <main className="main">
        {!repo ? (
          <div className="panel">
            <h3>No repository selected</h3>
            <p className="muted">
              Clone a repository URL or upload a zip archive containing <code>.git</code> from the left
              panel. Analysis runs in the background and is cached, so the dashboard is instant afterwards.
            </p>
          </div>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 10 }}>
              <h2 style={{ margin: 0 }}>{repo.name}</h2>
              <span className="small muted">
                {repo.head ? `${repo.head.slice(0, 10)}` : ""} · {repo.source}
                {repo.analyzed_in ? ` · indexed in ${repo.analyzed_in.toFixed(1)}s` : ""}
              </span>
              {busy && <span className="spinner" title="recomputing" />}
            </div>

            <FilterBar
              filters={filters}
              authors={authors}
              onChange={patch}
              onClear={() => setFilters({ ...EMPTY_FILTERS, ref: filters.ref })}
            />

            <div style={{ marginTop: 16 }}>
              <div className="section-title">
                {metrics ? `${metrics.object.kind}: ${metrics.object.path || "/"}` : "Metrics"}
              </div>
              <MetricCards m={metrics} />
            </div>

            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab ${t.key === tab ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.title}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              {breakdown ? (
                <BreakdownTable
                  items={breakdown.items}
                  showOwnership={Boolean(active.ownership)}
                  onPickPath={
                    tab === "child" || tab === "file"
                      ? (p) => {
                          setFilters((f) => ({ ...f, object_path: p }));
                          setTab("child");
                        }
                      : undefined
                  }
                  emptyLabel="Nothing changed under these filters."
                />
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
            <button className="btn small" onClick={() => setError(null)}>
              dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
