import type { Metadata } from "next";
import { Carlito } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";
// nextjs-toploader removed (client feedback 2026-06-17): the orange
// progress line was painting for 4+ seconds during route transitions,
// reading as a blocker instead of progress. Without it the new page
// content streams in directly — same nav speed, no false «still
// loading» signal.

// Carlito is the open-source font that exactly matches Calibri's
// metrics (same glyph widths, same line-height) — operators 2026-06-23:
// «шрифт надо поменять. все говорят что 0 и 8 сливаются, но везде
// должен быть один и тот же стиль/шрифт. пользователи привыкли к
// Excel». Switching from DM Sans (text) + JetBrains Mono (numbers) to
// a single Carlito stack across both --font-sans and --font-mono
// gives the operator the Excel look they're used to without dragging
// in Microsoft's proprietary font file. Subsets include cyrillic.
// The variable points to the same family so `font-mono` utility class
// still resolves to a defined value but renders the same glyph as
// `font-sans` — tabular-nums on data cells keeps columns aligned.
const carlito = Carlito({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "700"],
  variable: "--font-sans",
  display: "swap",
});
const carlitoMono = Carlito({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "700"],
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
    <html lang="ru" className={`h-full antialiased ${carlito.variable} ${carlitoMono.variable}`}>
      <body className="min-h-full flex flex-col">
        {/* NuqsAdapter wires nuqs' useQueryState/useQueryStates to the
            Next.js App Router so search-param state survives client
            navigations (e.g. /deals → /registry → /deals keeps the
            filter selections intact). Must wrap any client component
            that calls useQueryState. */}
        <NuqsAdapter>
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <Toaster position="top-right" richColors />
        </NuqsAdapter>
      </body>
    </html>
  );
}
