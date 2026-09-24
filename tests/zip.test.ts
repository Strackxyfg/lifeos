import { describe, it, expect } from "vitest";
import { ZipWriter, crc32 } from "@/lib/export/zip";

const bytes = (s: string) => new TextEncoder().encode(s);

/** Reads an archive back from its end record, as any unzip tool does. */
function unzip(archive: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = archive.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLength = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(archive.subarray(p + 46, p + 46 + nameLength));
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    const localName = v.getUint16(offset + 26, true);
    const data = archive.subarray(offset + 30 + localName, offset + 30 + localName + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    p += 46 + nameLength;
  }
  return files;
}

function build(entries: [string, Uint8Array][]): Uint8Array {
  const z = new ZipWriter();
  const chunks = entries.flatMap(([name, data]) => z.file(name, data, new Date("2026-09-24T10:30:00Z")));
  chunks.push(z.finish());
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

describe("the export archive", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("round-trips text and binary files, names in UTF-8", () => {
    const audio = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff);
    const files = unzip(
      build([
        ["second-cerveau.md", bytes("# Mon cerveau\n- Idée à creuser")],
        ["enregistrements/7413179c.webm", audio],
        ["enregistrements/7413179c.json", bytes('{"words":[]}')],
      ])
    );
    expect([...files.keys()]).toEqual(["second-cerveau.md", "enregistrements/7413179c.webm", "enregistrements/7413179c.json"]);
    expect(new TextDecoder().decode(files.get("second-cerveau.md"))).toBe("# Mon cerveau\n- Idée à creuser");
    expect(files.get("enregistrements/7413179c.webm")).toEqual(audio);
  });

  it("refuses names that could escape the folder it is unzipped into, and duplicates", () => {
    const z = new ZipWriter();
    expect(() => z.file("../evil.sh", bytes("x"))).toThrow();
    expect(() => z.file("/etc/passwd", bytes("x"))).toThrow();
    expect(() => z.file("a/../../b", bytes("x"))).toThrow();
    z.file("a.txt", bytes("x"));
    expect(() => z.file("a.txt", bytes("y"))).toThrow();
  });

  it("is a valid empty archive with no file", () => {
    expect(unzip(build([])).size).toBe(0);
  });
});
