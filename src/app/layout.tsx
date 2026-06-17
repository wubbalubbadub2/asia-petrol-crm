import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
// nextjs-toploader removed (client feedback 2026-06-17): the orange
// progress line was painting for 4+ seconds during route transitions,
// reading as a blocker instead of progress. Without it the new page
// content streams in directly — same nav speed, no false «still
// loading» signal.

// next/font/google — fonts are inlined into the Next.js build at
// generation time. No render-blocking <link rel="stylesheet"> handshake
// to fonts.googleapis.com, no FOIT. swap=auto so the page paints with
// the system fallback first, then upgrades the moment the font binary
// arrives (already cached). Replaces three blocking <link> tags
// (DM Sans + JetBrains Mono + Satoshi from fontshare).
// `subsets` types in next/font don't currently expose cyrillic for
// DM_Sans but Google's font file does ship it. Cast is safe.
const dmSans = DM_Sans({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subsets: ["latin", "latin-ext"] as ("latin" | "latin-ext")[],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"] as ("latin" | "latin-ext")[],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Singularity Trading CRM",
  description: "CRM и управление сделками Singularity Trading",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`h-full antialiased ${dmSans.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
