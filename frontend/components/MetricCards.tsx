"use client";

import type { Metrics } from "../lib/types";
import { fmtExact, fmtPct, fmtRate, signClass, signed } from "../lib/format";

export default function MetricCards({ m }: { m: Metrics | null }) {
  const cards: { label: string; value: string; hint?: string; cls?: string }[] = [
    { label: "Commits in set", value: m ? fmtExact(m.commit_count) : "—", hint: "|H|" },
    { label: "Added lines", value: m ? fmtExact(m.added) : "—", hint: "l+", cls: "pos" },
    { label: "Removed lines", value: m ? fmtExact(m.removed) : "—", hint: "l−", cls: "neg" },
    m
      ? { label: "Growth", value: signed(m.growth), hint: "added − removed", cls: signClass(m.growth) }
      : { label: "Growth", value: "—" },
    m ? { label: "Churn", value: fmtExact(m.churn), hint: "added + removed" } : { label: "Churn", value: "—" },
    m ? { label: "Modifications", value: fmtExact(m.modifications), hint: "commits with churn > 0" } : { label: "Modifications", value: "—" },
    m
      ? { label: "Mod. frequency", value: fmtPct(m.mod_frequency), hint: "modifications / |H|" }
      : { label: "Mod. frequency", value: "—" },
    m
      ? { label: "Churn rate", value: fmtRate(m.churn_rate), hint: "churn / |H|" }
      : { label: "Churn rate", value: "—" },
  ];

  return (
    <div className="cards">
      {cards.map((c) => (
        <div className="card" key={c.label}>
          <div className="label">{c.label}</div>
          <div className={`value ${c.cls || ""}`}>{c.value}</div>
          {c.hint && <div className="hint">{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}
