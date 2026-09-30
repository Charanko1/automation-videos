import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office — YouTube Factory",
  description: "True 3D AI office management game"
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
