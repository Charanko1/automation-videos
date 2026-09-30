import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office — YouTube Factory",
  description: "Production workspace for orchestrating AI-assisted video workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
