"use client";

import { useMemo, useState } from "react";
import type { BreakdownItem } from "../lib/types";
import { fmtExact, fmtPct, fmtRate, signClass, signed } from "../lib/format";

type SortKey =
  | "label" | "added" | "removed" | "growth" | "churn"
  | "modifications" | "mod_frequency" | "churn_rate" | "ownership";

const NUMERIC: SortKey[] = [
  "added", "removed", "growth", "churn", "modifications", "mod_frequency", "churn_rate", "ownership",
];

export default function BreakdownTable({
  items,
  onPickPath,
  showOwnership = false,
  emptyLabel = "Nothing changed under this path for the current filters.",
  pageSize = 250,
}: {
  items: BreakdownItem[];
  onPickPath?: (path: string) => void;
  showOwnership?: boolean;
  emptyLabel?: string;
  pageSize?: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("churn");
  const [asc, setAsc] = useState(false);
  const [visible, setVisible] = useState(pageSize);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => {
      let av: number | string = a[sortKey as keyof BreakdownItem] as number | string;
      let bv: number | string = b[sortKey as keyof BreakdownItem] as number | string;
      if (NUMERIC.includes(sortKey)) {
        av = Number(av ?? 0);
        bv = Number(bv ?? 0);
      }
      const cmp = sortKey === "label" ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, asc]);

  const shown = sorted.slice(0, visible);

  function head(key: SortKey, title: string) {
    return (
      <th
        onClick={() => {
          if (key === sortKey) setAsc(!asc);
          else {
            setSortKey(key);
            setAsc(key === "label");
          }
        }}
        title={`Sort by ${title}`}
      >
        {title}
        {sortKey === key ? (asc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  if (items.length === 0) return <div className="small muted">{emptyLabel}</div>;

  const maxChurn = Math.max(1, ...items.map((i) => i.churn || 0));

  return (
    <>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              {head("label", "Object")}
              {head("added", "Added")}
              {head("removed", "Removed")}
              {head("growth", "Growth")}
              {head("churn", "Churn")}
              {head("modifications", "Mods")}
              {head("mod_frequency", "Mod freq")}
              {head("churn_rate", "Churn rate")}
              {showOwnership ? head("ownership", "Ownership") : null}
              <th>Churn share</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => {
              const path = it.path;
              const canDrill = Boolean(onPickPath) && it.kind === "directory";
              return (
                <tr key={it.key}>
                  <td className="name-cell">
                    {canDrill ? (
                      <button className="link-btn" onClick={() => onPickPath!(path!)} title={path}>
                        🗀 {it.label}
                      </button>
                    ) : (
                      <span title={path || it.label}>{it.kind === "file" ? "🗎 " : ""}{it.label}</span>
                    )}
                  </td>
                  <td className="pos">{fmtExact(it.added)}</td>
                  <td className="neg">{fmtExact(it.removed)}</td>
                  <td className={signClass(it.growth)}>{signed(it.growth)}</td>
                  <td>{fmtExact(it.churn)}</td>
                  <td>{fmtExact(it.modifications)}</td>
                  <td>{fmtPct(it.mod_frequency)}</td>
                  <td>{fmtRate(it.churn_rate)}</td>
                  {showOwnership ? <td>{fmtPct(it.ownership ?? 0)}</td> : null}
                  <td style={{ width: 90 }}>
                    <div className="bar" title={`${fmtExact(it.churn)} lines changed`}>
                      <div style={{ width: `${Math.min(100, (it.churn / maxChurn) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="small muted">
          showing {shown.length.toLocaleString()} of {items.length.toLocaleString()} rows
        </span>
        {visible < items.length && (
          <button className="btn small" onClick={() => setVisible((v) => v + pageSize)}>
            Show more
          </button>
        )}
      </div>
    </>
  );
}
