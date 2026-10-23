import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Arma el PDF de una agenda del día (hoja A4 apaisada con una tabla). Es una función pura, sin base de
 * datos ni sesión: recibe el texto ya armado y devuelve el archivo, así se prueba sola.
 *
 * Usa las tipografías estándar de PDF (Helvetica), que no necesitan archivos de fuentes pero solo
 * conocen el alfabeto latino básico: cualquier otro símbolo se reemplaza para que nunca falle.
 */

export type PdfAgenda = {
  centerName: string;
  title: string;
  subtitle: string;
  /** Anchos relativos: se reparten a lo ancho de la hoja. */
  columns: { header: string; width: number }[];
  rows: string[][];
  emptyMessage: string;
  /** Pie de cada página (quién la generó y cuándo). */
  footer: string;
};

const PAGE = { width: 841.89, height: 595.28 }; // A4 apaisada
const MARGIN = 36;
const FONT_SIZE = 8.5;
const LINE_HEIGHT = 11;
const PAD = 4;
const MAX_LINES = 4;
const FOOTER_SPACE = 28;

const TEXT = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const ACCENT = rgb(0.05, 0.58, 0.53);
const HEADER_BG = rgb(0.91, 0.95, 0.94);
const ZEBRA = rgb(0.97, 0.97, 0.98);
const LINE = rgb(0.82, 0.83, 0.86);

/** Deja solo lo que la tipografía puede dibujar (el resto, como emojis o flechas, pasa a "?" o "->"). */
function printable(text: string, font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return text
    .normalize("NFC")
    .replace(/→/g, "->")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\r/g, "")
    .split("")
    .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)!) ? ch : "?"))
    .join("");
}

/** Parte el texto en líneas que entren en `width`; si pasa de `maxLines`, corta con "...". */
function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number) {
  const lines: string[] = [];
  let truncated = false;
  const push = (line: string) => {
    if (lines.length < maxLines) lines.push(line);
    else truncated = true;
  };

  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current) push(current);
      // Palabra más larga que la celda: se corta por letras.
      current = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(current + ch, size) > width && current) {
          push(current);
          current = ch;
        } else current += ch;
      }
    }
    push(current);
  }

  if (truncated && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && font.widthOfTextAtSize(`${last}...`, size) > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}...`;
  }
  return lines.length > 0 ? lines : [""];
}

export async function buildAgendaPdf(data: PdfAgenda): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(printable(data.title, regular));
  pdf.setProducer("Salus");
  pdf.setCreator("Salus");

  const contentWidth = PAGE.width - MARGIN * 2;
  const totalWeight = data.columns.reduce((sum, c) => sum + c.width, 0);
  const widths = data.columns.map((c) => (c.width / totalWeight) * contentWidth);
  const bottom = MARGIN + FOOTER_SPACE;

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const draw = (text: string, x: number, baseline: number, font: PDFFont, size: number, color = TEXT) =>
    page.drawText(printable(text, font), { x, y: baseline, size, font, color });

  function tableHeader() {
    const height = LINE_HEIGHT + PAD * 2;
    page.drawRectangle({ x: MARGIN, y: y - height, width: contentWidth, height, color: HEADER_BG });
    let x = MARGIN;
    data.columns.forEach((column, i) => {
      draw(column.header, x + PAD, y - PAD - FONT_SIZE + 1.5, bold, FONT_SIZE);
      x += widths[i];
    });
    y -= height;
  }

  // Encabezado de la primera página
  draw(data.centerName, MARGIN, y - 14, bold, 14, ACCENT);
  y -= 34;
  draw(data.title, MARGIN, y - 12, bold, 16);
  y -= 22;
  draw(data.subtitle, MARGIN, y - 10, regular, 10, MUTED);
  y -= 26;
  tableHeader();

  if (data.rows.length === 0) {
    draw(data.emptyMessage, MARGIN + PAD, y - PAD - FONT_SIZE - 6, regular, 10, MUTED);
  }

  data.rows.forEach((row, rowIndex) => {
    const cells = row.map((cell, i) => wrap(printable(cell, regular), regular, FONT_SIZE, widths[i] - PAD * 2, MAX_LINES));
    const height = Math.max(...cells.map((lines) => lines.length)) * LINE_HEIGHT + PAD * 2;

    if (y - height < bottom) {
      page = pdf.addPage([PAGE.width, PAGE.height]);
      y = PAGE.height - MARGIN;
      draw(`${data.title} (continuación)`, MARGIN, y - 10, bold, 10, MUTED);
      y -= 20;
      tableHeader();
    }

    if (rowIndex % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - height, width: contentWidth, height, color: ZEBRA });
    page.drawLine({ start: { x: MARGIN, y: y - height }, end: { x: MARGIN + contentWidth, y: y - height }, thickness: 0.5, color: LINE });

    let x = MARGIN;
    cells.forEach((lines, i) => {
      lines.forEach((line, n) => draw(line, x + PAD, y - PAD - FONT_SIZE + 1.5 - n * LINE_HEIGHT, regular, FONT_SIZE));
      x += widths[i];
    });
    y -= height;
  });

  // Pie con el número de página (se dibuja al final, cuando se sabe cuántas hay).
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(printable(data.footer, regular), { x: MARGIN, y: MARGIN, size: 7.5, font: regular, color: MUTED });
    const label = `Página ${i + 1} de ${pages.length}`;
    p.drawText(label, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(label, 7.5),
      y: MARGIN,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return pdf.save();
}
