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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
