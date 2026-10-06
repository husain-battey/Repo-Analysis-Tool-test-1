export type Repo = {
  id: string;
  name: string;
  source: "clone" | "zip";
  url: string | null;
  status: "cloning" | "uploading" | "extracting" | "analyzing" | "ready" | "error";
  head?: string;
  error?: string;
  analyzed_in?: number;
  stats?: { commits: number; authors: number; files: number; changes: number };
};

export type Job = {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  phase: string;
  progress: number;
  message: string;
  repo_id: string | null;
  error: string | null;
};

export type Author = {
  id: string;
  commits: number;
  merged_from: string[];
};

export type Metrics = {
  object: { kind: "repository" | "file" | "directory" | "unknown"; path: string };
  commit_count: number;
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  mod_frequency: number;
  churn_rate: number;
};

export type BreakdownItem = Metrics & {
  key: string;
  label: string;
  path?: string;
  kind?: string;
  ownership?: number;
  total_churn?: number;
};

export type Breakdown = {
  object: Metrics["object"];
  commit_count: number;
  totals: Metrics;
  items: BreakdownItem[];
};

export type CommitRow = {
  idx: number;
  hash: string;
  hash_short: string;
  author: string;
  committer_ts: number;
  subject: string;
};

export type Filters = {
  ref: string;
  object_path: string;
  authors: string[];
  from_ts: number | null;
  to_ts: number | null;
  commit_hashes: string[];
};

export const EMPTY_FILTERS: Filters = {
  ref: "HEAD",
  object_path: "",
  authors: [],
  from_ts: null,
  to_ts: null,
  commit_hashes: [],
};

export type TreeItem = { name: string; kind: "directory" | "file"; path: string };
