import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
  "U.S. high-power rocketry motor availability aggregated across vendors. " +
  "AeroTech, Cesaroni & Loki stock + pricing in one searchable view.";

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
// `.dark` and the native `color-scheme`. It also writes the *resolved* value to
// a cookie so the server can render the matching `.dark` class on <html> on the
// next request — that's what prevents the dark→light→dark hydration flash (the
// server otherwise renders no theme class, and React reconciles the script's
// `.dark` away for a frame). Kept in sync afterward by <ThemeToggle>.
const themeInit = `(function(){try{var t=localStorage.getItem('hpr.theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';document.cookie='hpr.theme.resolved='+(d?'dark':'light')+';path=/;max-age=31536000;samesite=lax';}catch(e){}})();`;

// Classic six-stripe Pride flag, left to right.
const PRIDE_GRADIENT =
  "linear-gradient(to right, #e40303, #ff8c00, #ffed00, #008026, #004dff, #750787)";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A small seasonal flourish: a thin rainbow rule at the top during June.
  // Computed per request, so it appears and disappears on its own.
  const isPrideMonth = new Date().getMonth() === 5;

  // Render the theme class on the server from the cookie the theme script wrote
  // last visit, so the SSR HTML already matches what the client will show — no
  // hydration mismatch, no flash. Unknown (first visit) defaults to dark: a dark
  // flash beats a light one, and a returning user's cookie makes it exact.
  const ssrDark = (await cookies()).get("hpr.theme.resolved")?.value !== "light";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${ssrDark ? " dark" : ""}`}
    >
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {isPrideMonth && (
          <div
            aria-hidden
            title="Happy Pride Month 🏳️‍🌈"
            className="h-1.5 w-full shrink-0"
            style={{ background: PRIDE_GRADIENT }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
