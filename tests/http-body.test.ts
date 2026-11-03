import { describe, it, expect } from "vitest";
import { readJson, readText } from "@/lib/http/body";

/**
 * Bodies are read only up to a limit: an announced size above it is refused
 * before reading, a stream that passes it is cut off there.
 */

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(x);
      c.close();
    },
  });

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

describe("bounded request bodies", () => {
  it("reads a body under the limit, as text or JSON", async () => {
    expect(await readText(post("hello"), 10)).toEqual({ text: "hello" });
    expect(await readJson(post('{"a":[1,2]}'), 100)).toEqual({ value: { a: [1, 2] } });
    expect(await readJson(post(null), 100)).toEqual({ value: undefined });
    // Not JSON: each route keeps its own answer to that.
    expect(await readJson(post("{nope"), 100)).toEqual({ value: undefined });
  });

  it("refuses a body announced larger than the limit without reading it", async () => {
    const req = post(streamOf([new Uint8Array(10)]), { "content-length": "2000000" });
    const r = await readText(req, 1000);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(413);
    expect(req.bodyUsed).toBe(false);
  });

  it("cuts off a stream that passes the limit when no size was announced", async () => {
    const chunk = new Uint8Array(600).fill(97);
    const r = await readText(post(streamOf([chunk, chunk, chunk])), 1000);
    expect((r as Response).status).toBe(413);
    expect(await (r as Response).json()).toEqual({ error: "too_large" });
  });

  it("decodes a character split between two pieces", async () => {
    const bytes = new TextEncoder().encode("é€");
    const r = await readText(post(streamOf([bytes.slice(0, 1), bytes.slice(1)])), 100);
    expect(r).toEqual({ text: "é€" });
  });
});
