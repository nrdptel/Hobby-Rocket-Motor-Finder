import type { Metadata } from "next";
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

// Set NEXT_PUBLIC_SITE_URL on the deploy host (Vercel / Cloudflare Pages) so
// OG / Twitter cards resolve the share image URL absolutely. Without it,
// social previews work locally but may fail when the URL is shared.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const description =
  "U.S. high-power rocketry motor availability aggregated across vendors. " +
  "AeroTech stock + pricing in one searchable view.";

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

// Resolve and apply the theme before first paint to avoid a flash of the wrong
// mode. Reads the persisted choice (light/dark/system; default system) and the
// OS preference, then toggles `.dark` and the native `color-scheme`. Kept in
// sync afterward by <ThemeToggle>.
const themeInit = `(function(){try{var t=localStorage.getItem('hpr.theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
