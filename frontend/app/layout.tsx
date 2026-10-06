import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAT — Repo Analysis Tool",
  description: "Git repository metrics dashboard: churn, growth, modifications and author ownership",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
