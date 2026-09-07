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
