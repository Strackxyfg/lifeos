import { describe, it, expect, afterEach } from "vitest";
import { resolveNotionRedirectUri, requestOrigin } from "@/lib/notion/redirect";

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

const original = process.env.NOTION_REDIRECT_URI;
afterEach(() => {
  if (original === undefined) delete process.env.NOTION_REDIRECT_URI;
  else process.env.NOTION_REDIRECT_URI = original;
});

describe("requestOrigin", () => {
  it("prefers Vercel's forwarded headers over the internal URL", () => {
    const r = req("http://10.0.0.7/api/x", {
      "x-forwarded-host": "lifeos-mu-taupe.vercel.app",
      "x-forwarded-proto": "https",
      host: "10.0.0.7",
    });
    expect(requestOrigin(r)).toBe("https://lifeos-mu-taupe.vercel.app");
  });

  it("assumes https for a public host with no proto header", () => {
    expect(requestOrigin(req("http://x/api", { host: "example.com" }))).toBe("https://example.com");
  });

  it("keeps http for localhost", () => {
    expect(requestOrigin(req("http://x/api", { host: "localhost:3000" }))).toBe("http://localhost:3000");
  });
});

describe("resolveNotionRedirectUri", () => {
  it("IGNORES a stale localhost env var when deployed — the bug this prevents", () => {
    process.env.NOTION_REDIRECT_URI = "http://localhost:3000/api/integrations/notion/callback";
    const r = req("https://lifeos-mu-taupe.vercel.app/api/integrations/notion/authorize", {
      host: "lifeos-mu-taupe.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(resolveNotionRedirectUri(r)).toBe(
      "https://lifeos-mu-taupe.vercel.app/api/integrations/notion/callback"
    );
  });

  it("honours the env var when its origin matches the request", () => {
    const configured = "https://lifeos-mu-taupe.vercel.app/api/integrations/notion/callback";
    process.env.NOTION_REDIRECT_URI = configured;
    const r = req("https://lifeos-mu-taupe.vercel.app/api/x", {
      host: "lifeos-mu-taupe.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(resolveNotionRedirectUri(r)).toBe(configured);
  });

  it("falls back cleanly when the env var is malformed", () => {
    process.env.NOTION_REDIRECT_URI = "not-a-url";
    const r = req("https://example.com/api/x", { host: "example.com", "x-forwarded-proto": "https" });
    expect(resolveNotionRedirectUri(r)).toBe("https://example.com/api/integrations/notion/callback");
  });

  it("works with no env var at all", () => {
    delete process.env.NOTION_REDIRECT_URI;
    const r = req("http://localhost:3000/api/x", { host: "localhost:3000" });
    expect(resolveNotionRedirectUri(r)).toBe("http://localhost:3000/api/integrations/notion/callback");
  });

  it("gives authorize and callback the same value — OAuth requires byte equality", () => {
    process.env.NOTION_REDIRECT_URI = "http://localhost:3000/api/integrations/notion/callback";
    const headers = { host: "lifeos-mu-taupe.vercel.app", "x-forwarded-proto": "https" };
    const authorize = resolveNotionRedirectUri(req("https://lifeos-mu-taupe.vercel.app/api/integrations/notion/authorize", headers));
    const callback = resolveNotionRedirectUri(req("https://lifeos-mu-taupe.vercel.app/api/integrations/notion/callback?code=x", headers));
    expect(authorize).toBe(callback);
  });
});
