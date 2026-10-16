/**
 * What an uploaded image really is, read from its bytes — never from the
 * name or the type the browser claims. Only raster formats a browser shows
 * as a picture are accepted (an SVG could carry a script), and the size
 * given back is the image's own, which the layout then uses.
 */

export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  ext: "png" | "jpg" | "webp" | "gif";
  width: number;
  height: number;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 24) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ok = (info: ImageInfo) => (info.width >= 1 && info.height >= 1 && info.width <= 20000 && info.height <= 20000 ? info : null);

  // PNG: the signature, then IHDR's width and height.
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return ok({ mime: "image/png", ext: "png", width: v.getUint32(16), height: v.getUint32(20) });
  }
  // GIF87a / GIF89a: the logical screen's size.
  if (ascii(b, 0, 4) === "GIF8" && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return ok({ mime: "image/gif", ext: "gif", width: v.getUint16(6, true), height: v.getUint16(8, true) });
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return ok({ mime: "image/webp", ext: "webp", width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff });
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      return ok({ mime: "image/webp", ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 });
    }
    if (chunk === "VP8X") {
      const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      return ok({ mime: "image/webp", ext: "webp", width: w, height: h });
    }
    return null;
  }
  // JPEG: walk the segments to the frame header.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return null;
      const marker = b[p + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      const len = v.getUint16(p + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return ok({ mime: "image/jpeg", ext: "jpg", width: v.getUint16(p + 7), height: v.getUint16(p + 5) });
      if (len < 2) return null;
      p += 2 + len;
    }
    return null;
  }
  return null;
}
