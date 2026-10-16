/**
 * Reading a ZIP archive (an XMind file is one), with the platform's own
 * inflate (DecompressionStream "deflate-raw": every current browser, and
 * Node 18+). No dependency.
 *
 * Bounded: an entry larger than `maxEntry` once inflated, or an archive with
 * more than `maxEntries` files, is refused — a ZIP bomb stops here.
 */

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  /** Inflated bytes. */
  read(): Promise<Uint8Array>;
}

export async function readZip(bytes: Uint8Array, opts: { maxEntries?: number; maxEntry?: number } = {}): Promise<Map<string, ZipEntry>> {
  const maxEntries = opts.maxEntries ?? 2000;
  const maxEntry = opts.maxEntry ?? 50 * 1024 * 1024;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record, searched from the end (a comment may follow it).
  let eocd = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--) {
    if (view.getUint32(p, true) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a ZIP archive.");
  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new ZipError("Too many files in the archive.");
  const out = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError("Damaged archive.");
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (size > maxEntry) throw new ZipError(`${name} is too large.`);
    out.set(name, {
      name,
      async read() {
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new ZipError("Damaged archive.");
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) return data.slice();
        if (method !== 8) throw new ZipError(`Unsupported compression in ${name}.`);
        return inflateRaw(data, maxEntry);
      },
    });
  }
  return out;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  // A copy on its own ArrayBuffer: what a Blob takes.
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError("A file in the archive is too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
