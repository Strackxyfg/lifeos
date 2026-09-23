"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (`public/sw.js`): an offline page, which also
 * makes LifeOS installable — and, installed, a target in the phone's share
 * sheet. Production only: in development a worker would outlive code changes
 * and serve stale pages.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not being installable is not an error the person should see.
    });
  }, []);
  return null;
}
