"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TreeItem } from "../lib/types";

/**
 * A lightweight file-tree browser that talks to the /api/repos/{id}/tree endpoint.
 * Opens as a floating panel; user navigates by clicking directories and picks a
 * path by clicking "Select" on any entry.
 */
export default function TreeBrowser({
  repoId,
  onSelect,
  onClose,
}: {
  repoId: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [items, setItems] = useState<TreeItem[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function navigate(p: string) {
    setBusy(true);
    setError(null);
    api
      .tree(repoId, p)
      .then((res) => {
        setPath(res.path);
        setParent(res.parent);
        setItems(res.items);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => { navigate(""); }, [repoId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="panel"
        style={{
          width: 500, maxWidth: "95vw", maxHeight: "80vh", overflow: "auto",
          display: "flex", flexDirection: "column", gap: 8, margin: 0,
        }}
      >
        <div className="row">
          <h3 style={{ margin: 0, flex: 1 }}>Browse path</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>

        {/* breadcrumb */}
        <div className="row wrap" style={{ gap: 4, fontFamily: "monospace", fontSize: 12 }}>
          <button className="link-btn" onClick={() => navigate("")}>⌂ root</button>
          {path.split("/").filter(Boolean).map((seg, i, arr) => {
            const p = arr.slice(0, i + 1).join("/");
            return (
              <span key={p} className="row" style={{ gap: 4 }}>
                <span className="muted">/</span>
                <button className="link-btn" onClick={() => navigate(p)}>{seg}</button>
              </span>
            );
          })}
          {busy && <span className="spinner" style={{ marginLeft: 6 }} />}
        </div>

        {error && <div className="error small">{error}</div>}

        {/* select current directory */}
        <div className="row" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8, gap: 6 }}>
          <span className="small muted grow">
            📁 {path || "/"} (this directory)
          </span>
          <button
            className="btn small primary"
            onClick={() => { onSelect(path); onClose(); }}
          >
            Select dir
          </button>
        </div>

        <div style={{ overflow: "auto" }}>
          {parent !== null && (
            <div className="row" style={{ padding: "3px 0" }}>
              <button
                className="link-btn small"
                style={{ flex: 1, textAlign: "left" }}
                onClick={() => navigate(parent)}
              >
                📂 ..
              </button>
            </div>
          )}
          {items.map((it) => (
            <div key={it.path} className="row" style={{ padding: "3px 0", gap: 6 }}>
              {it.kind === "directory" ? (
                <button
                  className="link-btn small grow"
                  style={{ textAlign: "left" }}
                  onClick={() => navigate(it.path)}
                >
                  📂 {it.name}
                </button>
              ) : (
                <span className="small grow" style={{ overflow: "hidden", textOverflow: "ellipsis",
                                                      whiteSpace: "nowrap", color: "var(--text)" }}>
                  🗎 {it.name}
                </span>
              )}
              <button
                className="btn small"
                onClick={() => { onSelect(it.path); onClose(); }}
              >
                Select
              </button>
            </div>
          ))}
          {!busy && items.length === 0 && <div className="small muted">Empty directory.</div>}
        </div>
      </div>
    </div>
  );
}
