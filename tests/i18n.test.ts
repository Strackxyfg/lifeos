import { describe, it, expect } from "vitest";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { locales, fill, isLocale } from "@/lib/i18n/config";

/** Collect every leaf key path, e.g. "nav.dashboard". */
function keyPaths(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) return [prefix];
  if (obj && typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      keyPaths(v, prefix ? `${prefix}.${k}` : k)
    );
  }
  return [prefix];
}

function leafValues(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (Array.isArray(obj)) return obj.flatMap(leafValues);
  if (obj && typeof obj === "object") return Object.values(obj as Record<string, unknown>).flatMap(leafValues);
  return [];
}

describe("i18n dictionaries", () => {
  it("exposes exactly the supported locales", () => {
    expect(Object.keys(dictionaries).sort()).toEqual([...locales].sort());
  });

  it("has identical key structure across locales", () => {
    const en = keyPaths(dictionaries.en).sort();
    const fr = keyPaths(dictionaries.fr).sort();
    expect(fr).toEqual(en);
  });

  it("has no empty or placeholder strings", () => {
    for (const locale of locales) {
      for (const v of leafValues(dictionaries[locale])) {
        expect(v.trim().length, `empty string in "${locale}"`).toBeGreaterThan(0);
        expect(v).not.toMatch(/^TODO/i);
      }
    }
  });

  it("actually translates — FR differs from EN on visible chrome", () => {
    expect(dictionaries.fr.nav.dashboard).not.toBe(dictionaries.en.nav.dashboard);
    expect(dictionaries.fr.brain.cat.ideas.label).not.toBe(dictionaries.en.brain.cat.ideas.label);
    expect(dictionaries.fr.auth.signIn).not.toBe(dictionaries.en.auth.signIn);
  });

  it("keeps the same interpolation tokens in both locales", () => {
    const tokens = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    expect(tokens(dictionaries.fr.assistant.seed)).toEqual(tokens(dictionaries.en.assistant.seed));
    expect(tokens(dictionaries.fr.dashboard.doneCount)).toEqual(tokens(dictionaries.en.dashboard.doneCount));
  });

  it("covers every seeded Second-Brain item in both locales", () => {
    const en = Object.keys(dictionaries.en.brain.items).sort();
    const fr = Object.keys(dictionaries.fr.brain.items).sort();
    expect(fr).toEqual(en);
    for (const id of en) {
      expect(dictionaries.fr.brain.items[id].title).not.toBe(dictionaries.en.brain.items[id].title);
    }
  });

  it("offers the same number of assistant suggestions", () => {
    expect(dictionaries.fr.assistant.suggestions).toHaveLength(
      dictionaries.en.assistant.suggestions.length
    );
  });
});

describe("i18n helpers", () => {
  it("fills interpolation tokens", () => {
    expect(fill("Hi {name}", { name: "Quinn" })).toBe("Hi Quinn");
    expect(fill("{done} of {total} done", { done: 2, total: 4 })).toBe("2 of 4 done");
  });

  it("leaves unknown tokens intact", () => {
    expect(fill("Hi {missing}", {})).toBe("Hi {missing}");
  });

  it("validates locales", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
