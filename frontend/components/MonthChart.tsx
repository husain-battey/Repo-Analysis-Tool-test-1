"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { BreakdownItem } from "../lib/types";
import { fmtNum } from "../lib/format";

const ADDED_COLOR = "var(--accent)";
const REMOVED_COLOR = "var(--red)";

function ChurnTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel" style={{ padding: "8px 12px", margin: 0, minWidth: 160 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="row small" style={{ gap: 8 }}>
          <span className="muted">{p.name}</span>
          <span style={{ fontFamily: "monospace" }}>{p.value.toLocaleString("en-US")}</span>
        </div>
      ))}
    </div>
  );
}

export default function MonthChart({ items }: { items: BreakdownItem[] }) {
  if (!items.length) return <div className="small muted">No data for this filter.</div>;

  const data = items.map((it) => ({
    month: it.label,
    added: it.added,
    removed: it.removed,
    churn: it.churn,
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
                  barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted)" }}
                 tickLine={false} axisLine={false}
                 interval={Math.max(0, Math.floor(data.length / 12) - 1)} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false}
                 axisLine={false} tickFormatter={(v: number) => fmtNum(v)} width={46} />
          <Tooltip content={<ChurnTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="added" name="Added" fill={ADDED_COLOR} radius={[2, 2, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={ADDED_COLOR} />)}
          </Bar>
          <Bar dataKey="removed" name="Removed" fill={REMOVED_COLOR} radius={[2, 2, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={REMOVED_COLOR} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
