/**
 * A ZIP archive, written as it goes — for exporting a brain with its
 * recordings.
 *
 * Stored, not deflated: the audio is already compressed, and the text is
 * small. Each file is emitted as soon as it is known (local header, then its
 * bytes); the central directory closes the archive. So an export can be
 * streamed file by file instead of being assembled in memory — a brain with
 * many recordings would otherwise exceed a serverless response's size limit.
 *
 * Plain ZIP (no ZIP64): up to 65,535 files and 4 GB, far beyond one brain.
 * Names are marked UTF-8. Pure; no dependency.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

const UTF8 = 0x0800;
const utf8 = new TextEncoder();

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private names = new Set<string>();

  /** The bytes that add one file to the archive, to emit now. */
  file(name: string, data: Uint8Array, modified: Date = new Date()): Uint8Array[] {
    if (!name || name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Unsafe name in archive: ${name}`);
    if (this.names.has(name)) throw new Error(`Duplicate name in archive: ${name}`);
    if (this.entries.length >= 0xffff) throw new Error("Too many files for a ZIP archive.");
    this.names.add(name);
    const bytes = utf8.encode(name);
    const crc = crc32(data);
    const { time, date } = dosTime(modified);
    const header = new Uint8Array(30 + bytes.length);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // version needed
    v.setUint16(6, UTF8, true);
    v.setUint16(8, 0, true); // stored
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, bytes.length, true);
    v.setUint16(28, 0, true);
    header.set(bytes, 30);
    this.entries.push({ name: bytes, crc, size: data.length, offset: this.offset, time, date });
    this.offset += header.length + data.length;
    if (this.offset > 0xffffffff) throw new Error("Archive too large for plain ZIP.");
    return [header, data];
  }

  /** The central directory and the end record: the archive's last bytes. */
  finish(): Uint8Array {
    const size = this.entries.reduce((n, e) => n + 46 + e.name.length, 0);
    const out = new Uint8Array(size + 22);
    const v = new DataView(out.buffer);
    let p = 0;
    for (const e of this.entries) {
      v.setUint32(p, 0x02014b50, true);
      v.setUint16(p + 4, 20, true); // made by
      v.setUint16(p + 6, 20, true); // needed
      v.setUint16(p + 8, UTF8, true);
      v.setUint16(p + 10, 0, true);
      v.setUint16(p + 12, e.time, true);
      v.setUint16(p + 14, e.date, true);
      v.setUint32(p + 16, e.crc, true);
      v.setUint32(p + 20, e.size, true);
      v.setUint32(p + 24, e.size, true);
      v.setUint16(p + 28, e.name.length, true);
      // extra, comment, disk, internal and external attributes: zero
      v.setUint32(p + 42, e.offset, true);
      out.set(e.name, p + 46);
      p += 46 + e.name.length;
    }
    v.setUint32(p, 0x06054b50, true);
    v.setUint16(p + 8, this.entries.length, true);
    v.setUint16(p + 10, this.entries.length, true);
    v.setUint32(p + 12, size, true);
    v.setUint32(p + 16, this.offset, true);
    return out;
  }
}
