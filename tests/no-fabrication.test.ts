import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Nothing the product shows may be invented and presented as real.
 *
 * An audit before the pivot found sixteen fabrications shipped to real users:
 * testimonials from people who don't exist, a Visa "ending 4242" and paid
 * invoices on the billing page, integrations shown as "Connected" that were
 * never built, a 23-day habit streak fed to the AI, and a "focus" and an
 * assistant greeting that told every user their investor deck was at risk.
 *
 * These are the exact phrases that shipped. Comments are stripped first, so
 * code may still *describe* what was removed; only live strings are checked.
 */

const ROOT = join(__dirname, "..");

const FORBIDDEN: { what: string; pattern: RegExp }[] = [
  { what: "invented testimonial authors", pattern: /Maya Chen|Daniel Okafor|Priya Nair|Tom Rivera/ },
  { what: "a fake payment card", pattern: /•{2,}\s*4242|ending 4242/i },
  { what: "a fake renewal date", pattern: /Renews August/ },
  { what: "the fabricated habit streak", pattern: /habitStreak|\b23-day\b|série de 23/ },
  { what: "an invented weekly score", pattern: /68\s?% (on-track|dans les temps)/ },
  { what: "a hardcoded timezone shown as the user's", pattern: /America\/Los_Angeles/ },
  {
    what: "build steps the Notion generator never performed",
    pattern: /Connecting calendars|Training your AI assistant|Setting up automations|Computing KPIs/,
  },
  { what: "a simulated build presented as progress", pattern: /mode: "simulated"/ },
  // The landing page, before the pivot.
  { what: "an invented waitlist size", pattern: /2,400\+|already waiting/ },
  { what: "a waitlist that stored nothing", pattern: /You're on the list/ },
  { what: "an invented generation time", pattern: /Generated in|>47s</ },
  { what: "a status light that measured nothing", pattern: /All systems operational/ },
  { what: "a guarantee on a product that takes no payment", pattern: /money-back|14-day guarantee/i },
  { what: "a company form that does not exist", pattern: /LifeOS AI, Inc\./ },
  { what: "integrations that were never built", pattern: /name: "(Gmail|Slack|Google Calendar|GitHub)"/ },
  { what: "total income labelled as recurring revenue", pattern: /kpiMrr|"MRR"/ },
  {
    what: "a hardcoded priority presented as analysis",
    pattern: /investor deck is your only|deck investisseurs est votre seul|close the three warm leads|closez les trois leads/i,
  },
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Drops // and /* *\/ comments (and JSX {/* *\/} ones) so only live code is checked. */
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const sources = ["app", "components", "lib"].flatMap((d) => files(join(ROOT, d)));

describe("no fabricated content", () => {
  it("scans the product source", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  for (const { what, pattern } of FORBIDDEN) {
    it(`contains no ${what}`, () => {
      const hits = sources
        .filter((f) => pattern.test(stripComments(readFileSync(f, "utf8"))))
        .map((f) => relative(ROOT, f));
      expect(hits, `${what} found in: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
