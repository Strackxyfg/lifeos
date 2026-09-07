import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { cn } from "@/lib/utils";
import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://lifeos.ai";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "LifeOS AI — Your entire life, organized in 60 seconds",
    template: "%s — LifeOS AI",
  },
  description:
    "LifeOS AI generates a complete, personalized Notion workspace — databases, dashboards, automations and an AI assistant — tailored to you in under 60 seconds.",
  keywords: [
    "Notion workspace generator",
    "AI productivity",
    "personal operating system",
    "Notion templates",
    "life management",
  ],
  authors: [{ name: "LifeOS AI" }],
  openGraph: {
    type: "website",
    url: APP_URL,
    title: "LifeOS AI — Your entire life, organized in 60 seconds",
    description:
      "Answer 10 questions. Get a complete Notion workspace built for how you actually work.",
    siteName: "LifeOS AI",
  },
  twitter: {
    card: "summary_large_image",
    title: "LifeOS AI",
    description: "Your entire life, organized in 60 seconds.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(GeistSans.variable, GeistMono.variable)}>
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
