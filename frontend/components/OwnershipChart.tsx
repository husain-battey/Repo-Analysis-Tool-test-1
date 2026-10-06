"use client";

import {
  Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip,
} from "recharts";
import type { BreakdownItem } from "../lib/types";
import { fmtPct, fmtExact } from "../lib/format";

// Distinct accent palette for up to 12 slices, then grey.
const PALETTE = [
  "#6d8bff","#ff6b6b","#4ecdc4","#ffe66d","#a29bfe",
  "#fd79a8","#55efc4","#fdcb6e","#74b9ff","#e17055",
  "#00cec9","#fab1a0",
];

function slice(label: string, i: number) {
  return i < PALETTE.length ? PALETTE[i] : "#555";
}

function OwnershipTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number; payload: BreakdownItem }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="panel" style={{ padding: "8px 12px", margin: 0, minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12,
                    overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240 }}>
        {d.name}
      </div>
      <div className="small row" style={{ gap: 8 }}>
        <span className="muted">Ownership</span>
        <span>{fmtPct(d.value)}</span>
      </div>
      <div className="small row" style={{ gap: 8 }}>
        <span className="muted">Churn</span>
        <span>{fmtExact(d.payload.churn)}</span>
      </div>
      <div className="small row" style={{ gap: 8 }}>
        <span className="muted">Modifications</span>
        <span>{fmtExact(d.payload.modifications)}</span>
      </div>
    </div>
  );
}

export default function OwnershipChart({ items }: { items: BreakdownItem[] }) {
  if (!items.length) return null;

  // Top 11 authors + "Others"
  const sorted = [...items].sort((a, b) => (b.ownership ?? 0) - (a.ownership ?? 0));
  const top = sorted.slice(0, 11);
  const rest = sorted.slice(11);
  const othersOwnership = rest.reduce((s, i) => s + (i.ownership ?? 0), 0);
  const othersChurn = rest.reduce((s, i) => s + i.churn, 0);

  const data = [
    ...top.map((it) => ({
      name: it.label,
      value: it.ownership ?? 0,
      churn: it.churn,
      modifications: it.modifications,
      ownership: it.ownership,
    })),
    ...(rest.length > 0
      ? [{ name: `${rest.length} others`, value: othersOwnership, churn: othersChurn,
           modifications: 0, ownership: othersOwnership }]
      : []),
  ].filter((d) => d.value > 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="40%"
            outerRadius="65%"
            paddingAngle={2}
            label={({ name, value }) =>
              value > 0.04 ? `${fmtPct(value, 0)}` : ""
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={slice(_.name, i)} />
            ))}
          </Pie>
          <Tooltip content={<OwnershipTooltip />} />
          <Legend
            formatter={(value: string) =>
              value.length > 28 ? value.slice(0, 27) + "…" : value
            }
            iconSize={10}
            wrapperStyle={{ fontSize: 11, lineHeight: "18px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
