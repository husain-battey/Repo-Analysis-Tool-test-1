export function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString("en-US");
}

export function fmtExact(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US");
}

export function fmtPct(x: number | undefined | null, digits = 1): string {
  if (x === undefined || x === null || Number.isNaN(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtRate(x: number | undefined | null): string {
  if (x === undefined || x === null || Number.isNaN(x)) return "—";
  return x >= 100 ? x.toFixed(0) : x.toFixed(2);
}

export function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** UTC midnight of an ISO date string, or null. */
export function dateToTs(value: string, endOfDay = false): number | null {
  if (!value) return null;
  const t = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export function signClass(n: number): string {
  return n > 0 ? "pos" : n < 0 ? "neg" : "";
}

export function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${fmtExact(n)}`;
}
