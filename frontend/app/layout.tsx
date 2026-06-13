import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { observancesForDate } from "@/lib/observances";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Origin used to resolve OG / Twitter card image URLs absolutely. Defaults to
// the production site; a fork can override with NEXT_PUBLIC_SITE_URL on its
// deploy host (Vercel / Cloudflare Pages) to point cards at its own domain.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motor.fusionspace.co";

const description =
  "U.S. high-power rocketry motor availability across vendors — AeroTech, Cesaroni " +
  "& Loki stock + pricing in one searchable view, with restock email alerts and " +
  "in-stock substitutes when a motor is sold out everywhere.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "HPR Motor Finder",
  description,
  openGraph: {
    type: "website",
    siteName: "HPR Motor Finder",
    title: "HPR Motor Finder",
    description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "HPR Motor Finder",
    description,
  },
};

// Emits <meta name="color-scheme" content="light dark">. The browser reads this
// during HTML parse — before CSS/JS — and paints the load/reload canvas to match
// the user's OS preference instead of defaulting to white. This is what stops
// the white flash on refresh for dark-mode users.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

// Resolve and apply the theme before first paint. Reads the persisted choice
// (light/dark/system; default system) and the OS preference, then toggles
// `.dark` and the native `color-scheme` on <html>. Running as the first child of
// <body>, this executes synchronously before the browser paints body content, so
// the correct theme is in place from the first frame — the same flash-free
// approach next-themes uses. `<html suppressHydrationWarning>` lets React keep
// the class the script set instead of reconciling it away. Kept in sync
// afterward by <ThemeToggle>. No cookie is needed, so the layout stays static
// (server-rendered HTML doesn't vary per request → cacheable / ISR).
const themeInit = `(function(){try{var t=localStorage.getItem('hpr.theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.classList.toggle('light',!d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Small monthly flourishes (Pride, Men's Mental Health Month, …) — a thin
  // accent rule per active observance, stacked at the very top. Re-evaluated
  // whenever the static HTML is (re)generated (ISR), so they appear and disappear
  // within a revalidation window on their own.
  const bars = observancesForDate().filter((o) => o.bar);

  // No theme class is rendered server-side: the static HTML is identical for
  // every visitor, and the inline `themeInit` script below applies the correct
  // theme to <html> before first paint. `suppressHydrationWarning` keeps React
  // from touching the class the script set during hydration.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {bars.map((o) => (
          <div
            key={o.id}
            aria-hidden
            title={o.bar!.title}
            className="h-1.5 w-full shrink-0"
            style={{ background: o.bar!.background }}
          />
        ))}
        {children}
      </body>
    </html>
  );
}
