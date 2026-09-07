import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://lifeos.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/generate", "/onboarding", "/api"] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
