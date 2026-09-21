import { describe, it, expect } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";

describe("post-login redirect", () => {
  const home = "/brain";

  it("keeps a path on this site, with its query and hash", () => {
    expect(safeNext("/settings", home)).toBe("/settings");
    expect(safeNext("/brain?q=x#y", home)).toBe("/brain?q=x#y");
  });

  it("falls back when there is nothing", () => {
    expect(safeNext(undefined, home)).toBe(home);
    expect(safeNext("", home)).toBe(home);
  });

  // Built from char codes: a backslash written as an escape can be silently
  // collapsed by whatever tool writes the file, turning "/\evil.com" into the
  // perfectly legitimate path "/evil.com" and making the test assert nothing.
  const BS = String.fromCharCode(92);
  const TAB = String.fromCharCode(9);

  it("refuses every way of leaving the site", () => {
    for (const evil of [
      "https://evil.com",
      "http://evil.com/brain",
      "//evil.com",
      `/${BS}evil.com`,
      `${BS}${BS}evil.com`,
      "javascript:alert(1)",
      "  //evil.com",
      `/${TAB}/evil.com`,
      "evil.com",
      "data:text/html,hi",
    ]) {
      expect(safeNext(evil, home), JSON.stringify(evil)).toBe(home);
    }
  });

  it("still accepts an ordinary path that merely looks like a domain", () => {
    // "/evil.com" is a path on *this* site, not a redirect elsewhere.
    expect(safeNext("/evil.com", home)).toBe("/evil.com");
  });
});
