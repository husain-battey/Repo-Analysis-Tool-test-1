import type { Author, Breakdown, CommitRow, Filters, Job, Metrics, Repo, TreeItem } from "./types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new Error("Cannot reach the RAT backend (is it running on port 8000?)");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`${res.status}: ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Strip filter fields that mean "no filter" so the payload stays small/clean. */
export function filterPayload(f: Filters) {
  return {
    ref: f.ref || "HEAD",
    object_path: f.object_path || "",
    authors: f.authors.length ? f.authors : null,
    from_ts: f.from_ts,
    to_ts: f.to_ts,
    commit_hashes: f.commit_hashes.length ? f.commit_hashes : null,
  };
}

export const api = {
  health: () => request<{ status: string; git: string; repos: number }>("/health"),
  repos: () => request<Repo[]>("/repos"),
  deleteRepo: (id: string) => request<{ deleted: string }>(`/repos/${id}`, { method: "DELETE" }),
  job: (id: string) => request<Job>(`/jobs/${id}`),

  clone: (url: string) =>
    request<{ job_id: string; repo_id: string }>("/repos/clone", json("POST", { url })),
  upload: async (file: File, onProgress?: (frac: number) => void): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/repos/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText).job_id);
          } catch {
            reject(new Error("Bad response from upload endpoint"));
          }
        } else {
          let msg = xhr.responseText;
          try {
            msg = JSON.parse(xhr.responseText).detail || msg;
          } catch {
            /* keep raw */
          }
          reject(new Error(`${xhr.status}: ${msg}`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed (network or backend error)"));
      xhr.send(form);
    });
  },

  authors: (id: string) => request<Author[]>(`/repos/${id}/authors`),
  getMerge: (id: string) => request<{ groups: string[][] }>(`/repos/${id}/merge`),
  setMerge: (id: string, groups: string[][]) =>
    request<{ groups: string[][] }>(`/repos/${id}/merge`, json("POST", { groups })),
  tree: (id: string, path: string) =>
    request<{ path: string; parent: string | null; items: TreeItem[] }>(
      `/repos/${id}/tree?path=${encodeURIComponent(path)}`,
    ),
  commits: (id: string, params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<{ total: number; items: CommitRow[] }>(`/repos/${id}/commits?${q.toString()}`);
  },
  refs: (id: string, search = "") =>
    request<{ items: { name: string; short: string; sha: string }[] }>(
      `/repos/${id}/refs?search=${encodeURIComponent(search)}`,
    ),

  metrics: (id: string, f: Filters) => request<Metrics>(`/repos/${id}/metrics`, json("POST", filterPayload(f))),
  breakdown: (id: string, f: Filters, dimension: string) =>
    request<Breakdown>(`/repos/${id}/breakdown`, json("POST", { ...filterPayload(f), dimension })),
};
