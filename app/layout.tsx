import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { cn } from "@/lib/utils";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://lifeos.ai";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  // The landing page sets its own, localized title and description; these
  // are the defaults for every other page.
  title: {
    default: "LifeOS — A second brain that belongs to you",
    template: "%s — LifeOS",
  },
  description:
    "Capture your thoughts, connect them, find them again. Your goals decide your focus, and an AI agent works from what you wrote.",
  keywords: ["second brain", "personal knowledge management", "AI agent", "productivity", "notes"],
  authors: [{ name: "LifeOS" }],
  openGraph: {
    type: "website",
    url: APP_URL,
    title: "LifeOS — A second brain that belongs to you",
    description: "Capture your thoughts, connect them, find them again — and let an AI agent work from them.",
    siteName: "LifeOS",
  },
  twitter: {
    card: "summary_large_image",
    title: "LifeOS",
    description: "A second brain that belongs to you.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The document language follows the interface, for screen readers,
  // hyphenation and search engines alike.
  const locale = await getLocale();
  return (
    <html lang={locale} className={cn(GeistSans.variable, GeistMono.variable)}>
      <body className="min-h-dvh bg-background font-sans antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('lifeos-theme')==='light')document.documentElement.classList.add('light')}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
