import { describe, it, expect } from "vitest";
import { challengeName, challengeValue, checkDomain, emailDomain, normalizeDomain } from "@/lib/enterprise/domains";

describe("a domain as typed", () => {
  it("is reduced to its canonical form", () => {
    expect(normalizeDomain(" https://www.Acme.com/careers?x=1 ")).toEqual({ ok: true, domain: "www.acme.com" });
    expect(normalizeDomain("@acme.com")).toEqual({ ok: true, domain: "acme.com" });
    expect(normalizeDomain("jo@acme.co.uk")).toEqual({ ok: true, domain: "acme.co.uk" });
    expect(normalizeDomain("acme.com.")).toEqual({ ok: true, domain: "acme.com" });
    expect(normalizeDomain("acme.com:443")).toEqual({ ok: true, domain: "acme.com" });
    // An international name, in the ASCII form DNS and the database use.
    expect(normalizeDomain("Café.fr")).toEqual({ ok: true, domain: "xn--caf-dma.fr" });
  });

  it("refuses what is not a domain", () => {
    for (const bad of ["", "acme", "localhost", "10.0.0.1", "acme..com", "-acme.com", "acme-.com", "a b.com", "acme.123", `${"a".repeat(64)}.com`]) {
      expect(normalizeDomain(bad), bad).toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("refuses public mailbox providers: an address there proves nothing about a company", () => {
    for (const d of ["gmail.com", "Outlook.com", "me@hotmail.fr", "proton.me", "skynet.be"]) {
      expect(normalizeDomain(d), d).toEqual({ ok: false, problem: "public" });
    }
  });

  it("reads an address's domain", () => {
    expect(emailDomain("Ada@Acme.COM")).toBe("acme.com");
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(emailDomain("@acme.com")).toBeNull();
    expect(emailDomain("ada@")).toBeNull();
  });
});

describe("the DNS challenge", () => {
  const token = "0123456789abcdef0123456789abcdef";

  it("lives under its own name", () => {
    expect(challengeName("acme.com")).toBe("_lifeos-challenge.acme.com");
    expect(challengeValue(token)).toBe(`lifeos-domain-verification=${token}`);
  });

  it("is verified when the record carries the token — even split in chunks", async () => {
    const asked: string[] = [];
    const resolver = async (name: string) => {
      asked.push(name);
      return [["v=spf1 -all"], ["lifeos-domain-verification=", token]];
    };
    expect(await checkDomain("acme.com", token, resolver)).toEqual({ state: "verified" });
    expect(asked).toEqual(["_lifeos-challenge.acme.com"]);
  });

  it("is missing when no record, or another token", async () => {
    const none = async () => {
      throw Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" });
    };
    expect(await checkDomain("acme.com", token, none)).toEqual({ state: "missing", seen: 0 });
    const other = async () => [["lifeos-domain-verification=ffffffffffffffffffffffffffffffff"]];
    expect(await checkDomain("acme.com", token, other)).toEqual({ state: "missing", seen: 1 });
  });

  it("reports a DNS failure as an error, not a verdict", async () => {
    const broken = async () => {
      throw Object.assign(new Error("queryTxt ESERVFAIL"), { code: "ESERVFAIL" });
    };
    expect(await checkDomain("acme.com", token, broken)).toEqual({ state: "error", code: "ESERVFAIL" });
  });
});
