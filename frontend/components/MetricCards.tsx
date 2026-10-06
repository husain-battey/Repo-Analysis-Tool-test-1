"use client";

import type { Metrics } from "../lib/types";
import { fmtExact, fmtPct, fmtRate, signClass, signed } from "../lib/format";

export default function MetricCards({ m }: { m: Metrics | null }) {
  const cards: { label: string; value: string; hint?: string; title?: string; cls?: string }[] = [
    { label: "Commits in set", value: m ? fmtExact(m.commit_count) : "—",
      hint: "|H|", title: "|H| — non-merge commits reachable from the reference commit, after filters" },
    { label: "Added lines", value: m ? fmtExact(m.added) : "—",
      hint: "l+", cls: "pos", title: "Sum of lines added across all commits in H" },
    { label: "Removed lines", value: m ? fmtExact(m.removed) : "—",
      hint: "l−", cls: "neg", title: "Sum of lines removed across all commits in H" },
    m
      ? { label: "Growth", value: signed(m.growth), hint: "added − removed",
          title: "Net change in lines: added minus removed", cls: signClass(m.growth) }
      : { label: "Growth", value: "—" },
    m ? { label: "Churn", value: fmtExact(m.churn), hint: "added + removed",
          title: "Total lines changed (added + removed) — measures activity regardless of direction" }
      : { label: "Churn", value: "—" },
    m ? { label: "Modifications", value: fmtExact(m.modifications), hint: "commits with Δ > 0",
          title: "Number of commits that touched this object (churn > 0); empty commits don't count" }
      : { label: "Modifications", value: "—" },
    m
      ? { label: "Mod. frequency", value: fmtPct(m.mod_frequency), hint: "n / |H|",
          title: "Modification frequency = modifications ÷ |H|; how often this object is touched per commit" }
      : { label: "Mod. frequency", value: "—" },
    m
      ? { label: "Churn rate", value: fmtRate(m.churn_rate), hint: "λ / |H|",
          title: "Churn rate = total churn ÷ |H|; average lines changed per commit in H" }
      : { label: "Churn rate", value: "—" },
  ];

  return (
    <div className="cards">
      {cards.map((c) => (
        <div className="card" key={c.label} title={c.title}>
          <div className="label">{c.label}</div>
          <div className={`value ${c.cls || ""}`}>{c.value}</div>
          {c.hint && <div className="hint">{c.hint}</div>}
        </div>
      ))}
    </div>
  );
}
