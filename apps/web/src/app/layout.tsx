import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./required-fields.css";

export const metadata: Metadata = {
  title: {
    default: "Landed KOL OS",
    template: "%s · Landed KOL OS",
  },
  description:
    "Creator campaign operations and verified Solana attribution for growth teams.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
