// Hand-built PDFs that need pdf.js runtime resources (see scripts/pdfjs-assets.mjs).

function assemble(objs: (string | Buffer)[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objs.forEach((o, i) => {
    const body = Buffer.isBuffer(o) ? o : Buffer.from(o, "latin1");
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(length);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref =
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

/**
 * A page of CJK text in a non-embedded font with a predefined Adobe CMap
 * (UniGB-UCS2-H). pdf.js needs `cMapUrl` to draw it. Latin line at the top.
 */
export function cjkPdf(): Buffer {
  const content = ["BT /F1 36 Tf 72 700 Td (Latin text) Tj ET", "BT /F2 96 Tf 72 450 Td <4E2D65876587672C> Tj ET"].join("\n");
  return assemble([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>",
  ]);
}

/**
 * A minimal valid JPEG 2000 codestream: 8×8, 1 component, 8-bit, no wavelet
 * levels, one tile with a single empty packet. Every coefficient is zero, so
 * after the DC level shift it decodes to uniform grey (128).
 */
export function greyJ2k(): Buffer {
  const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const siz = [0xff, 0x51, ...u16(41), ...u16(0), ...u32(8), ...u32(8), ...u32(0), ...u32(0), ...u32(8), ...u32(8), ...u32(0), ...u32(0), ...u16(1), 0x07, 0x01, 0x01];
  // Scod 0; LRCP, 1 layer, no MCT; 0 decomposition levels, 64×64 code-blocks, style 0, 5/3 reversible.
  const cod = [0xff, 0x52, ...u16(12), 0x00, 0x00, ...u16(1), 0x00, 0x00, 0x04, 0x04, 0x00, 0x01];
  // No quantisation, 2 guard bits; exponent 8 for the single LL band.
  const qcd = [0xff, 0x5c, ...u16(4), 0x40, 0x40];
  const packet = [0x00]; // empty packet
  const psot = 12 + 2 + packet.length;
  const sot = [0xff, 0x90, ...u16(10), ...u16(0), ...u32(psot), 0x00, 0x01];
  return Buffer.from([0xff, 0x4f, ...siz, ...cod, ...qcd, ...sot, 0xff, 0x93, ...packet, 0xff, 0xd9]);
}

/** A "scanned" page: one JPEG 2000 (JPXDecode) image covering a box. pdf.js needs `wasmUrl` (OpenJPEG). */
export function scannedJpxPdf(): Buffer {
  const j2k = greyJ2k();
  const content = "q 400 0 0 300 106 300 cm /Im1 Do Q";
  return assemble([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /Length ${j2k.length} >>\nstream\n`, "latin1"),
      j2k,
      Buffer.from("\nendstream", "latin1"),
    ]),
  ]);
}
