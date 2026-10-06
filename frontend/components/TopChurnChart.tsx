"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { BreakdownItem } from "../lib/types";
import { fmtNum, fmtExact } from "../lib/format";

function TopChurnTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel" style={{ padding: "8px 12px", margin: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 11,
                    maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="small row" style={{ gap: 8 }}>
          <span className="muted">{p.name}</span>
          <span>{fmtExact(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function TopChurnChart({
  items,
  limit = 15,
  label = "Top objects by churn",
}: {
  items: BreakdownItem[];
  limit?: number;
  label?: string;
}) {
  if (!items.length) return null;

  const top = [...items]
    .sort((a, b) => b.churn - a.churn)
    .slice(0, limit);

  const data = top.map((it) => ({
    name: it.label.length > 32 ? "…" + it.label.slice(-30) : it.label,
    fullName: it.label,
    added: it.added,
    removed: it.removed,
    churn: it.churn,
    kind: it.kind,
  }));

  const maxChurn = data[0]?.churn ?? 1;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="section-title" style={{ marginBottom: 4 }}>{label}</div>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 28 + 20)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          barCategoryGap="25%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fontSize: 11, fill: "var(--text)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<TopChurnTooltip />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="churn" name="Churn" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => {
              const frac = d.churn / maxChurn;
              // gradient from accent to red based on churn magnitude
              const r = Math.round(109 + (255 - 109) * frac);
              const g = Math.round(139 + (107 - 139) * frac);
              const b = Math.round(255 + (107 - 255) * frac);
              return <Cell key={i} fill={`rgb(${r},${g},${b})`} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
