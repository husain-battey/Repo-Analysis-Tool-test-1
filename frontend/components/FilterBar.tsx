"use client";

import { useMemo, useState } from "react";
import type { Author, Filters } from "../lib/types";
import { fmtDate, dateToTs } from "../lib/format";

/** Author picker: searchable checkbox list, closed by the transparent backdrop. */
function AuthorPicker({
  authors,
  selected,
  onToggle,
}: {
  authors: Author[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? authors.filter((a) => a.id.toLowerCase().includes(q)) : authors;
    const chosen = q
      ? selected.filter((s) => s.toLowerCase().includes(q)).map((s) => ({ id: s, commits: 0, merged_from: [] }))
      : [];
    const seen = new Set(pool.map((a) => a.id));
    return [...chosen.filter((c) => !seen.has(c.id)), ...pool].slice(0, 400);
  }, [authors, query, selected]);

  return (
    <div style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} title="Filter by author">
        Authors{selected.length ? ` (${selected.length})` : ""} ▾
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
          />
          <div
            className="panel"
            style={{
              position: "absolute",
              top: 34,
              left: 0,
              width: 360,
              maxHeight: 340,
              overflow: "auto",
              zIndex: 41,
              margin: 0,
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            }}
          >
            <input
              className="field"
              placeholder="search authors…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="small muted" style={{ margin: "6px 0" }}>
              {authors.length.toLocaleString()} authors · checking one or more restricts the commit set
            </div>
            {list.length === 0 && <div className="small muted">No author matches “{query}”.</div>}
            {list.map((a) => (
              <label key={a.id} className="row" style={{ padding: "3px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selected.includes(a.id)}
                  onChange={() => onToggle(a.id)}
                />
                <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.id}
                </span>
                <span className="small muted">{a.commits.toLocaleString()}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function FilterBar({
  filters,
  authors,
  onChange,
  onClear,
}: {
  filters: Filters;
  authors: Author[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const [pathDraft, setPathDraft] = useState(filters.object_path);

  const fromValue = filters.from_ts ? fmtDate(filters.from_ts) : "";
  const toValue = filters.to_ts ? fmtDate(filters.to_ts) : "";
  const label = filters.object_path
    ? filters.object_path
    : `${filters.ref || "HEAD"} (repository root)`;

  const chips: { text: string; clear: () => void }[] = [];
  if (filters.object_path) {
    chips.push({
      text: `path: ${filters.object_path}`,
      clear: () => {
        setPathDraft("");
        onChange({ object_path: "" });
      },
    });
  }
  if ((filters.ref || "HEAD") !== "HEAD") {
    chips.push({ text: `ref: ${filters.ref}`, clear: () => onChange({ ref: "HEAD" }) });
  }
  for (const a of filters.authors) {
    chips.push({
      text: `author: ${a}`,
      clear: () => onChange({ authors: filters.authors.filter((x) => x !== a) }),
    });
  }
  if (filters.from_ts || filters.to_ts) {
    chips.push({
      text: `since ${filters.from_ts ? fmtDate(filters.from_ts) : "…"} → ${filters.to_ts ? fmtDate(filters.to_ts) : "…"}`,
      clear: () => onChange({ from_ts: null, to_ts: null }),
    });
  }
  if (filters.commit_hashes.length) {
    chips.push({
      text: `${filters.commit_hashes.length} selected commits`,
      clear: () => onChange({ commit_hashes: [] }),
    });
  }

  return (
    <div className="panel">
      <div className="row wrap" style={{ gap: 8 }}>
        <input
          className="field"
          style={{ width: 260 }}
          value={pathDraft}
          placeholder="file or directory path (empty = repository)"
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onChange({ object_path: pathDraft.trim() })}
          title="Filter metrics to one file or directory"
        />
        <button
          className="btn"
          onClick={() => {
            const p = pathDraft.trim();
            onChange({ object_path: p });
          }}
        >
          Apply path
        </button>
        <button
          className="btn"
          onClick={() => {
            setPathDraft("");
            onChange({ object_path: "" });
          }}
          title="Measure the whole repository"
        >
          Root
        </button>

        <input
          className="field"
          style={{ width: 150 }}
          value={filters.ref}
          placeholder="ref (HEAD, tag, sha)"
          onChange={(e) => onChange({ ref: e.target.value })}
          title="Reference commit: H̄ is the non-merge history reachable from here"
        />

        <AuthorPicker
          authors={authors}
          selected={filters.authors}
          onToggle={(id) =>
            onChange({
              authors: filters.authors.includes(id)
                ? filters.authors.filter((x) => x !== id)
                : [...filters.authors, id],
            })
          }
        />

        <label className="small muted">from</label>
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={fromValue}
          onChange={(e) => onChange({ from_ts: dateToTs(e.target.value) })}
        />
        <label className="small muted">to</label>
        <input
          type="date"
          className="field"
          style={{ width: 150 }}
          value={toValue}
          onChange={(e) => onChange({ to_ts: dateToTs(e.target.value, true) })}
        />
      </div>

      <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
        <span className="small muted">Scoping to</span>
        <span className="chip">{label}</span>
        {chips.map((c) => (
          <span className="chip" key={c.text}>
            {c.text}
            <button onClick={c.clear} title="Remove this filter">
              ✕
            </button>
          </span>
        ))}
        {chips.length > 0 && (
          <button className="btn small" onClick={onClear}>
            Clear all filters
          </button>
        )}
      </div>
    </div>
  );
}
