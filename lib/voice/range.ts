/**
 * HTTP byte ranges for playing a recording.
 *
 * A browser seeking in an `<audio>` element asks for part of the file
 * (`Range: bytes=START-END`); a server that answers only whole files leaves
 * seeking broken in Safari and slow elsewhere. Single ranges only — what
 * media elements send. Pure.
 */

export type ByteRange = { start: number; end: number };

/** null: send the whole file. "invalid": answer 416. */
export function parseRange(header: string | null, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!m || (m[1] === "" && m[2] === "") || size <= 0) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-500": the last 500 bytes.
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}
