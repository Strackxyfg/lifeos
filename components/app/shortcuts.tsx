"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Raycast/Linear-style "G then key" navigation chords.
 * G D → Dashboard, G P → Projects, G C → CRM, G F → Finance,
 * G A → Assistant, G N → Analytics, G T → Team, G S → Settings, G B → Billing.
 * Ignored while typing in inputs; the second key must land within 1s.
 */
const MAP: Record<string, string> = {
  d: "/dashboard",
  p: "/projects",
  c: "/crm",
  f: "/finance",
  a: "/assistant",
  r: "/brain",
  g: "/agent",
  n: "/analytics",
  t: "/team",
  s: "/settings",
  b: "/billing",
};

export function Shortcuts() {
  const router = useRouter();

  useEffect(() => {
    let armed = false;
    let at = 0;

    const isTyping = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();

      if (armed && Date.now() - at < 1000) {
        const dest = MAP[key];
        armed = false;
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }

      if (key === "g") {
        armed = true;
        at = Date.now();
      } else {
        armed = false;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return null;
}
