"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type RefEntry = { name: string; short: string; sha: string };

/**
 * Ref input with autocomplete dropdown backed by /api/repos/{id}/refs.
 * Falls back to plain text input when no repoId is provided.
 */
export default function RefInput({
  repoId,
  value,
  onChange,
}: {
  repoId: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RefEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!repoId || !open) return;
    if (debounce.current) clearTimeout(debounce.current);
    setLoading(true);
    debounce.current = setTimeout(() => {
      api
        .refs(repoId, value === "HEAD" ? "" : value)
        .then((res) => setItems(res.items))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [repoId, value, open]);

  function pick(r: RefEntry) {
    onChange(r.sha.length === 40 ? r.short || r.sha.slice(0, 10) : r.name);
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        className="field"
        style={{ width: 150 }}
        value={value}
        placeholder="ref (HEAD, branch, tag, sha)"
        title="Reference commit: H̄ is the non-merge history reachable from here"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => repoId && setOpen(true)}
        onBlur={(e) => {
          if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      />
      {open && repoId && (
        <div
          className="panel"
          style={{
            position: "absolute", top: 34, left: 0, width: 300, maxHeight: 280,
            overflow: "auto", zIndex: 50, margin: 0,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          {loading && <div className="small muted" style={{ padding: 4 }}>loading refs…</div>}
          {!loading && items.length === 0 && (
            <div className="small muted" style={{ padding: 4 }}>No refs match "{value}".</div>
          )}
          {/* HEAD shortcut */}
          <div
            className="row"
            style={{ padding: "4px 6px", cursor: "pointer", gap: 8 }}
            tabIndex={0}
            onMouseDown={() => { onChange("HEAD"); setOpen(false); }}
          >
            <span className="small" style={{ color: "var(--accent)", fontFamily: "monospace" }}>
              HEAD
            </span>
            <span className="small muted grow">latest non-merge commit</span>
          </div>
          {items.map((r) => (
            <div
              key={r.sha + r.name}
              className="row"
              style={{ padding: "4px 6px", cursor: "pointer", gap: 8 }}
              tabIndex={0}
              onMouseDown={() => pick(r)}
            >
              <span
                className="small"
                style={{ fontFamily: "monospace", color: "var(--accent)", flexShrink: 0 }}
              >
                {r.sha.slice(0, 8)}
              </span>
              <span
                className="small grow"
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {r.short || r.name}
              </span>
              {r.short !== r.name && r.short && (
                <span className="small muted" style={{ flexShrink: 0 }}>{r.name.split("/").pop()}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
