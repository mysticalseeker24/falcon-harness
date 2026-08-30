import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Falcon — Evidence Console",
  description: "Diff-scoped exploitation agent. A request, a response, and a verdict — a proven fact.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
