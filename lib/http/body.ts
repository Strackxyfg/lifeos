/**
 * Reading a request's body without trusting its size.
 *
 * `req.json()` and `req.text()` hold the whole body in memory before anyone
 * looks at it, and a route handler has no size limit of its own: a client
 * could send a gigabyte to any endpoint that reads one. Here the body is read
 * piece by piece and dropped as soon as it passes the limit; a declared
 * Content-Length above it is refused before a byte is read.
 *
 * It also bounds what a validator is handed: a schema library walking a huge
 * array (zod collects one issue per bad element) is a memory problem of its own.
 */

export const KB = 1024;

/** The body as text, or a 413 response to return as is. */
export async function readText(req: Request, max: number): Promise<{ text: string } | Response> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return tooLarge();
  if (!req.body) return { text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { text: new TextDecoder().decode(all) };
}

/** The body as JSON (`undefined` when it is not JSON — each route keeps its own answer to that), or a 413 response. */
export async function readJson(req: Request, max: number): Promise<{ value: unknown } | Response> {
  const read = await readText(req, max);
  if (read instanceof Response) return read;
  try {
    return { value: read.text ? (JSON.parse(read.text) as unknown) : undefined };
  } catch {
    return { value: undefined };
  }
}

const tooLarge = () => Response.json({ error: "too_large" }, { status: 413 });
