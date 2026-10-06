"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Author } from "../lib/types";

/**
 * Author merge panel.
 *
 * Displays all known authors and lets the user form groups where the first
 * entry is the canonical name and the rest are aliases.  Persists to
 * POST /api/repos/{id}/merge.  Mailmap-derived identities are shown as-is
 * (they were already merged by git when the repo was indexed).
 */
export default function MergePanel({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const [authors, setAuthors] = useState<Author[]>([]);
  const [groups, setGroups] = useState<string[][]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setBusy(true);
    Promise.all([api.authors(repoId), api.getMerge(repoId)])
      .then(([a, m]) => {
        if (!live) return;
        setAuthors(a);
        setGroups(m.groups.length ? m.groups : []);
        setBusy(false);
      })
      .catch((e) => {
        if (!live) return;
        setError((e as Error).message);
        setBusy(false);
      });
    return () => { live = false; };
  }, [repoId]);

  // All author ids not yet in any merge group.
  const mergedIds = new Set(groups.flat());
  const free = authors.filter((a) => !mergedIds.has(a.id));
  const shown = query
    ? free.filter((a) => a.id.toLowerCase().includes(query.toLowerCase()))
    : free;

  function addGroup(canon: string) {
    setGroups((gs) => [...gs, [canon]]);
  }

  function addAlias(groupIdx: number, alias: string) {
    setGroups((gs) => gs.map((g, i) => (i === groupIdx ? [...g, alias] : g)));
  }

  function removeFromGroup(groupIdx: number, memberId: string) {
    setGroups((gs) => {
      const g = gs[groupIdx].filter((m) => m !== memberId);
      if (g.length < 2) {
        // dissolve the group — sole remaining member goes back to free list
        return gs.filter((_, i) => i !== groupIdx);
      }
      return gs.map((og, i) => (i === groupIdx ? g : og));
    });
  }

  function removeGroup(groupIdx: number) {
    setGroups((gs) => gs.filter((_, i) => i !== groupIdx));
  }

  async function save() {
    setSaving(true);
    try {
      await api.setMerge(repoId, groups.filter((g) => g.length >= 2));
      setError(null);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
               display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="panel"
        style={{ width: 700, maxWidth: "95vw", maxHeight: "85vh", overflow: "auto",
                 display: "flex", flexDirection: "column", gap: 12, margin: 0, position: "relative" }}
      >
        <div className="row">
          <h3 style={{ margin: 0, flex: 1 }}>Merge Authors</h3>
          <button className="btn small" onClick={onClose}>✕ Close</button>
        </div>

        <p className="small muted" style={{ margin: 0 }}>
          Authors whose identities were already unified by the repository's <code>.mailmap</code> are
          shown here after that automatic merge. Use the groups below to combine any remaining
          duplicates. The first entry in each group becomes the canonical identity.
        </p>

        {error && <div className="error">{error}</div>}

        {busy ? (
          <div className="small muted"><span className="spinner" /> loading…</div>
        ) : (
          <>
            {/* Active merge groups */}
            {groups.length > 0 && (
              <div>
                <div className="section-title">merge groups</div>
                {groups.map((g, gi) => (
                  <div key={gi} className="panel" style={{ margin: "6px 0", padding: 10 }}>
                    <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
                      <span className="small muted">canonical →</span>
                      <span className="chip" style={{ fontWeight: 600 }}>
                        {g[0]}
                        <button onClick={() => removeGroup(gi)} title="dissolve this group">✕</button>
                      </span>
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {g.slice(1).map((alias) => (
                        <span key={alias} className="chip">
                          {alias}
                          <button onClick={() => removeFromGroup(gi, alias)} title="remove alias">✕</button>
                        </span>
                      ))}
                      <span className="small muted">← aliases</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Free author list */}
            <div>
              <div className="section-title">
                unmerged authors ({free.length.toLocaleString()})
              </div>
              <input
                className="field"
                placeholder="search authors…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ marginBottom: 6 }}
              />
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                {shown.slice(0, 300).map((a) => (
                  <div key={a.id} className="row" style={{ padding: "3px 0", gap: 8 }}>
                    <span className="grow small"
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.id}
                    </span>
                    <span className="small muted">{a.commits.toLocaleString()}</span>
                    <button
                      className="btn small"
                      title="Make this the canonical identity of a new merge group"
                      onClick={() => addGroup(a.id)}
                    >
                      New group
                    </button>
                    {groups.map((g, gi) => (
                      <button
                        key={gi}
                        className="btn small"
                        title={`Add as alias under "${g[0]}"`}
                        onClick={() => addAlias(gi, a.id)}
                        style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        → {g[0].split(" ")[0]}
                      </button>
                    ))}
                  </div>
                ))}
                {shown.length > 300 && (
                  <div className="small muted">{shown.length - 300} more — refine the search</div>
                )}
              </div>
            </div>

            <div className="row" style={{ marginTop: 4 }}>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? "saving…" : "Save merge groups"}
              </button>
              <button className="btn" onClick={onClose}>Cancel</button>
              <span className="small muted grow" style={{ textAlign: "right" }}>
                {groups.filter((g) => g.length >= 2).length} active group
                {groups.filter((g) => g.length >= 2).length !== 1 ? "s" : ""}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
