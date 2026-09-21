import { describe, it, expect } from "vitest";
import { cn, formatCurrency } from "@/lib/utils";

describe("cn", () => {
  it("merges and de-duplicates conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", false && "hidden", "font-medium")).toBe("text-sm font-medium");
  });
});

describe("formatCurrency", () => {
  it("formats standard amounts", () => {
    expect(formatCurrency(49)).toBe("$49");
  });
  it("uses compact notation for large amounts", () => {
    expect(formatCurrency(24180)).toMatch(/\$24/);
  });
});

describe("formatCurrency — locale", () => {
  // Intl inserts a narrow no-break space (U+202F) as the French thousands
  // separator and before the symbol; normalise whitespace so the assertion
  // tests the format rather than a particular space character.
  const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

  it("puts the symbol after the amount in French", () => {
    expect(plain(formatCurrency(49, "fr"))).toBe("49 $US");
  });

  it("groups thousands the French way", () => {
    expect(plain(formatCurrency(1234, "fr"))).toBe("1 234 $US");
  });

  it("keeps English as the default, so existing callers are unchanged", () => {
    expect(formatCurrency(49)).toBe("$49");
    expect(formatCurrency(49, "en")).toBe("$49");
  });

  it("falls back to English for an unknown locale rather than throwing", () => {
    expect(formatCurrency(49, "xx")).toBe("$49");
  });
});
