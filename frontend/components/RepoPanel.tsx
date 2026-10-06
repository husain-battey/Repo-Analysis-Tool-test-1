"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Job, Repo } from "../lib/types";

const SAMPLE = "https://github.com/DaveGamble/cJSON.git";

export default function RepoPanel({
  repos,
  selectedId,
  onSelect,
  onRefresh,
}: {
  repos: Repo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function poll(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await api.job(jobId);
        setJob(j);
        if (j.status === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          setUploadPct(null);
          onRefresh();
          if (j.repo_id) onSelect(j.repo_id);
        } else if (j.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          setUploadPct(null);
          setError(j.error || "Ingestion failed");
          onRefresh();
        }
      } catch (e) {
        if (pollRef.current) clearInterval(pollRef.current);
        setBusy(false);
        setError(String((e as Error).message));
      }
    }, 800);
  }

  async function startClone() {
    const trimmed = url.trim();
    if (!trimmed) return setError("Enter a repository URL");
    setError(null);
    setBusy(true);
    try {
      const res = await api.clone(trimmed);
      setUrl("");
      poll(res.job_id);
    } catch (e) {
      setBusy(false);
      setError(String((e as Error).message));
    }
  }

  async function startUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a .zip archive first");
    setError(null);
    setBusy(true);
    setUploadPct(0);
    try {
      const jobId = await api.upload(file, (f) => setUploadPct(Math.round(f * 100)));
      fileRef.current && (fileRef.current.value = "");
      poll(jobId);
    } catch (e) {
      setBusy(false);
      setUploadPct(null);
      setError(String((e as Error).message));
    }
  }

  const pct = job ? Math.round((job.progress || 0) * 100) : 0;

  return (
    <>
      <div>
        <div className="section-title">Add repository</div>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="field grow"
            placeholder={`clone URL, e.g. ${SAMPLE}`}
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startClone()}
          />
          <button className="btn primary" onClick={startClone} disabled={busy}>
            Clone
          </button>
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <input ref={fileRef} type="file" accept=".zip" className="field grow" disabled={busy} />
          <button className="btn" onClick={startUpload} disabled={busy}>
            Upload zip
          </button>
        </div>
        {uploadPct !== null && (
          <div className="small muted" style={{ marginTop: 6 }}>
            Uploading… {uploadPct}%
          </div>
        )}
        {busy && job && (
          <div style={{ marginTop: 8 }}>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="small muted" style={{ marginTop: 5 }}>
              {job.phase} — {job.message} ({pct}%)
            </div>
          </div>
        )}
        {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      </div>

      <div>
        <div className="section-title">Repositories</div>
        {repos.length === 0 && (
          <div className="small muted">None yet. Clone a URL or upload a zip.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {repos.map((r) => (
            <div
              key={r.id}
              className={`repo-item ${r.id === selectedId ? "active" : ""}`}
              onClick={() => r.status === "ready" && onSelect(r.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && r.status === "ready" && onSelect(r.id)}
            >
              <span className="name">{r.name}</span>
              <span className="meta">
                {r.status === "ready" && r.stats
                  ? `${r.stats.commits.toLocaleString()} commits · ${r.stats.authors} authors · ${r.stats.files.toLocaleString()} files`
                  : r.status === "error"
                    ? `error: ${r.error || "failed"}`
                    : `${r.source} · ${r.status}`}
              </span>
              {r.source === "clone" && r.url && (
                <span className="meta" style={{ opacity: 0.7 }} title={r.url}>
                  {r.url.length > 42 ? `${r.url.slice(0, 42)}…` : r.url}
                </span>
              )}
              <div className="row" style={{ marginTop: 4 }}>
                <button
                  className="btn small danger"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Remove ${r.name} and its analysis cache?`)) return;
                    try {
                      await api.deleteRepo(r.id);
                      onRefresh();
                    } catch (err) {
                      setError(String((err as Error).message));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
