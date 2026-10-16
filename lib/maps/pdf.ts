/**
 * A one-page PDF holding a picture of the map — what "Export → PDF" gives,
 * to print or send. Written by hand (a PDF is a small text structure around
 * the JPEG, which PDF reads as is): no library, a few hundred bytes of
 * overhead. The page is the picture's size, so nothing is cropped or
 * stretched; a picture larger than PDF's page limit is shown smaller.
 */

const MAX_POINTS = 14400;

/** PDF text string: UTF-16BE with its byte-order mark, in hex — any language. */
function pdfText(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number, title: string): Uint8Array {
  // 96 px per inch on screen, 72 points per inch on paper.
  let w = widthPx * 0.75;
  let h = heightPx * 0.75;
  const shrink = Math.min(1, MAX_POINTS / w, MAX_POINTS / h);
  w = Math.round(w * shrink * 100) / 100;
  h = Math.round(h * shrink * 100) / 100;
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  object(6, `<< /Title ${pdfText(title)} /Producer (LifeOS) /Creator (LifeOS) >>`);

  const xref = length;
  let table = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(`${table}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
