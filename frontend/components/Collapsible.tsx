"use client";

import { useState } from "react";

export default function Collapsible({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "none", border: "none", padding: "2px 0",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          color: "var(--muted)", fontSize: 11, textTransform: "uppercase",
          letterSpacing: "0.09em", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 9, display: "inline-block",
                       transform: open ? "rotate(90deg)" : "rotate(0deg)",
                       transition: "transform 0.15s" }}>▶</span>
        {title}
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}
