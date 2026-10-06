"use client";

import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { BreakdownItem } from "../lib/types";
import { fmtNum } from "../lib/format";

function GrowthTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="panel" style={{ padding: "8px 12px", margin: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div className="small row" style={{ gap: 8 }}>
        <span className="muted">Cumulative growth</span>
        <span className={val >= 0 ? "pos" : "neg"}>
          {val >= 0 ? "+" : ""}{val.toLocaleString("en-US")} lines
        </span>
      </div>
    </div>
  );
}

/**
 * Shows the running net growth of the codebase over time, derived from the
 * month-by-month breakdown.  Months with no activity retain the previous
 * cumulative value so the line is continuous.
 */
export default function GrowthChart({ items }: { items: BreakdownItem[] }) {
  if (items.length < 2) return null;

  const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label));
  let running = 0;
  const data = sorted.map((it) => {
    running += it.growth;
    return { month: it.label, growth: running };
  });

  const max = Math.max(...data.map((d) => Math.abs(d.growth)));
  const domain: [number, number] = [-max * 1.1, max * 1.1];

  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-title" style={{ marginBottom: 4 }}>
        Cumulative net growth (lines)
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="growthGradNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--red)" stopOpacity={0.02} />
              <stop offset="95%" stopColor="var(--red)" stopOpacity={0.25} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--muted)" }}
                 tickLine={false} axisLine={false}
                 interval={Math.max(0, Math.floor(data.length / 10) - 1)} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted)" }} tickLine={false}
                 axisLine={false} tickFormatter={(v: number) => fmtNum(v)}
                 domain={domain} width={46} />
          <Tooltip content={<GrowthTooltip />} cursor={{ stroke: "var(--border)" }} />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
          <Area
            type="monotone"
            dataKey="growth"
            name="Cumulative growth"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#growthGrad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
