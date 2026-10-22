"use strict";

const { timingSafeEqual } = require("node:crypto");

/**
 * Who may talk to the local server: the LifeOS window, and nothing else on
 * this computer.
 *
 *  - The Host header must be the loopback address and port the server was
 *    given. A web page that points its own domain at 127.0.0.1 (DNS
 *    rebinding) sends its own name, and is refused.
 *  - The request must carry this launch's secret, which the app sets as a
 *    cookie on its window only. Another browser on the machine, or another
 *    program, does not have it.
 */

function cookieValue(header, name) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !a.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function allowed(headers, { port, token }) {
  const host = String(headers.host || "").toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  return sameSecret(cookieValue(headers.cookie, "lifeos_desktop"), token);
}

module.exports = { allowed, cookieValue };
