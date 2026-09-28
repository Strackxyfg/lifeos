import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a verification build run without clobbering the `.next` a dev server
  // is using (they share the directory otherwise, which corrupts the dev
  // server's RSC payloads). Defaults to the normal location.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // This project is the root. Next otherwise guesses from lockfiles and can
  // settle on a parent folder that merely has one of its own.
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  // Pages retired in the pivot. They showed fabricated data; old bookmarks
  // and muscle-memory shortcuts land on the second brain instead of a 404.
  // (/team was one of them; it is a real page again — teams and circles —
  // and shows only what members shared.)
  async redirects() {
    return [{ source: "/analytics", destination: "/brain", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The microphone is for LifeOS's own voice memos; nothing else
          // is used, and nothing embedded may ask for it.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
      {
        // A new worker must be picked up on the next visit, not a day later.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
