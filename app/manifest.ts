import type { MetadataRoute } from "next";
import { BRAND_BACKGROUND } from "@/lib/brand/mark";

/**
 * LifeOS as an installable app. Installed on a phone, it appears in the
 * system's share sheet: a page, a passage, a link shared from any app lands
 * on /share, where the person confirms it into their brain. The shortcuts
 * are the two things done fastest from a home screen: empty your head, ask.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "LifeOS — second brain",
    short_name: "LifeOS",
    description: "Capture your thoughts, connect them, find them again.",
    start_url: "/brain",
    scope: "/",
    display: "standalone",
    background_color: BRAND_BACKGROUND,
    theme_color: BRAND_BACKGROUND,
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    shortcuts: [
      { name: "Vider ma tête · Brain dump", short_name: "Dump", url: "/brain?dump=1" },
      { name: "Mon cerveau · My brain", short_name: "Brain", url: "/brain" },
    ],
  };
}
