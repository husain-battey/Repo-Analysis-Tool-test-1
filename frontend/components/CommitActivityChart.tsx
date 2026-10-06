"use client";

import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { BreakdownItem } from "../lib/types";

function CommitTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel" style={{ padding: "8px 12px", margin: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="small row" style={{ gap: 8 }}>
        <span className="muted">Commits</span>
        <span>{payload[0].value.toLocaleString("en-US")}</span>
      </div>
    </div>
  );
}

export default function CommitActivityChart({ items }: { items: BreakdownItem[] }) {
  if (items.length < 2) return null;

  const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label));
  const data = sorted.map((it) => ({ month: it.label, commits: it.modifications }));
  const avg = data.reduce((s, d) => s + d.commits, 0) / data.length;

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted)" }}
                 tickLine={false} axisLine={false}
                 interval={Math.max(0, Math.floor(data.length / 10) - 1)} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false}
                 axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={<CommitTooltip />} cursor={{ stroke: "var(--border)" }} />
          <ReferenceLine y={avg} stroke="var(--muted)" strokeDasharray="4 2"
                         label={{ value: "avg", position: "right",
                                  fill: "var(--muted)", fontSize: 10 }} />
          <Line type="monotone" dataKey="commits" name="Commits"
                stroke="var(--accent)" strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: "var(--accent)" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
