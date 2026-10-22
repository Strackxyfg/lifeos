"use strict";

/**
 * Where the app window may go. The window has no address bar, so a link that
 * led it to another site would look like LifeOS: only LifeOS itself (and, in
 * cloud mode, its sign-in provider) opens inside; everything else opens in
 * the person's browser, and only web or mail links at all.
 */

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Whether `url` may load in the app window, given the allowed origins ("https://*.supabase.co" allowed as a pattern). */
function isAllowedNavigation(url, origins) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  for (const o of origins) {
    if (o.startsWith("https://*.")) {
      const suffix = o.slice("https://*".length); // ".supabase.co"
      if (u.protocol === "https:" && u.hostname.endsWith(suffix) && u.hostname.length > suffix.length && !u.port) return true;
    } else if (u.origin === o) {
      return true;
    }
  }
  return false;
}

/** Whether a link may be handed to the system (browser, mail client). */
function isExternalSafe(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

module.exports = { originOf, isAllowedNavigation, isExternalSafe };
