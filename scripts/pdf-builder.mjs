// Dependency-free generator for simple test PDFs (shared by fixtures and e2e tests).
// Without outline/links the output is byte-identical to earlier versions.

/**
 * @typedef {{ title: string, page: number, children?: OutlineItem[] }} OutlineItem
 * @typedef {{ text: string, x: number, y: number, toPage?: number, uri?: string }} LinkSpec
 *   A visible label drawn at (x, y) in 14 pt Helvetica, clickable as an internal
 *   link (toPage, 1-based) or an external URI.
 * @typedef {{ encrypted?: boolean, outline?: OutlineItem[], links?: Record<number, LinkSpec[]>, label?: string }} BuildOptions
 */

/** Escape a string for a PDF literal string. */
const pdfString = (s) => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

/** @param {number} pageCount @param {BuildOptions} [options] @returns {Buffer} */
export function buildPdf(pageCount, { encrypted = false, outline = [], links = {}, label } = {}) {
  const objects = []; // index i => object number i + 1
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  const contentOf = [];
  for (let n = 1; n <= pageCount; n++) {
    const pageLinks = links[n] ?? [];
    const lines = [
      `BT /F1 48 Tf 72 680 Td (Page ${n}) Tj ET`,
      `BT /F1 14 Tf 72 640 Td (${label ?? `PageTurn test fixture - ${pageCount} pages`}) Tj ET`,
      ...Array.from({ length: 20 }, (_, i) =>
        `BT /F1 11 Tf 72 ${600 - i * 22} Td (Line ${i + 1} of page ${n}. The quick brown fox jumps over the lazy dog.) Tj ET`),
      `BT /F1 12 Tf 290 40 Td (${n}) Tj ET`,
      ...pageLinks.map((l) => `0 0 0.8 rg BT /F1 14 Tf ${l.x} ${l.y} Td ${pdfString(l.text)} Tj ET 0 g`),
    ].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(lines)} >>\nstream\n${lines}\nendstream`);
    contentOf.push(content);
    kids.push(add(null)); // page body set below, once annotation objects exist
  }

  // Link annotations (RDR-12 fixture).
  const annotsOf = kids.map((_, i) =>
    (links[i + 1] ?? []).map((l) => {
      const width = l.text.length * 7.5; // ~Helvetica 14 pt
      const rect = [l.x - 2, l.y - 4, l.x + width + 2, l.y + 14].map((v) => Math.round(v)).join(" ");
      const target = l.toPage ? `/Dest [${kids[l.toPage - 1]} 0 R /Fit]` : `/A << /S /URI /URI ${pdfString(l.uri ?? "")} >>`;
      return add(`<< /Type /Annot /Subtype /Link /Rect [${rect}] /Border [0 0 0] ${target} >>`);
    }),
  );
  kids.forEach((page, i) => {
    const annots = annotsOf[i].length ? ` /Annots [${annotsOf[i].map((a) => `${a} 0 R`).join(" ")}]` : "";
    objects[page - 1] = `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentOf[i]} 0 R${annots} >>`;
  });

  // Document outline / table of contents (RDR-10 fixture).
  let outlineRef = 0;
  if (outline.length) {
    outlineRef = add(null);
    const build = (items, parent) => {
      const refs = items.map(() => add(null));
      items.forEach((item, i) => {
        const children = item.children?.length ? build(item.children, refs[i]) : null;
        objects[refs[i] - 1] =
          `<< /Title ${pdfString(item.title)} /Parent ${parent} 0 R /Dest [${kids[item.page - 1]} 0 R /Fit]` +
          (i > 0 ? ` /Prev ${refs[i - 1]} 0 R` : "") +
          (i < items.length - 1 ? ` /Next ${refs[i + 1]} 0 R` : "") +
          (children ? ` /First ${children.first} 0 R /Last ${children.last} 0 R /Count ${children.count}` : "") +
          " >>";
      });
      const count = items.reduce((sum, it) => sum + 1 + (it.children?.length ?? 0), 0);
      return { first: refs[0], last: refs[refs.length - 1], count };
    };
    const top = build(outline, outlineRef);
    objects[outlineRef - 1] = `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.count} >>`;
  }

  objects[catalog - 1] = outlineRef
    ? `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${outlineRef} 0 R /PageMode /UseOutlines >>`
    : `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pageCount} >>`;

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");

  // Password-protected fixture: a Standard security handler whose O/U entries don't
  // match the empty password, so readers (pdf.js) must ask for a password
  // (PasswordException). Streams stay unencrypted; they are never reached.
  const hex = (pair, n) => pair.repeat(n);
  const encrypt = encrypted
    ? ` /Encrypt << /Filter /Standard /V 1 /R 2 /O <${hex("ab", 32)}> /U <${hex("cd", 32)}> /P -44 >> /ID [<${hex("01", 16)}> <${hex("01", 16)}>]`
    : "";
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
