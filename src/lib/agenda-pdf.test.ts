import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildAgendaPdf, type PdfAgenda } from "./agenda-pdf";

const base: PdfAgenda = {
  centerName: "Salus",
  title: "Agenda del día · Dr. Pérez",
  subtitle: "Traumatología · Lunes 26 de octubre de 2026 · 2 turnos",
  columns: [
    { header: "Hora", width: 1 },
    { header: "Paciente", width: 3 },
    { header: "Observaciones", width: 3 },
  ],
  rows: [
    ["09:00-09:20", "Núñez, Ángela", "Traer estudios"],
    ["09:20-09:40", "Pérez, José", ""],
  ],
  emptyMessage: "No hay turnos para este día.",
  footer: "Salus · Generado por las pruebas",
};

const pagesOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe("buildAgendaPdf", () => {
  it("genera un PDF válido de una página", async () => {
    const bytes = await buildAgendaPdf(base);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(await pagesOf(bytes)).toBe(1);
  });

  it("pagina cuando hay muchos turnos", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`${String(8 + Math.floor(i / 3)).padStart(2, "0")}:00`, `Paciente ${i}`, "Obs"]);
    expect(await pagesOf(await buildAgendaPdf({ ...base, rows }))).toBeGreaterThan(2);
  });

  it("no falla con una agenda vacía", async () => {
    expect(await pagesOf(await buildAgendaPdf({ ...base, rows: [] }))).toBe(1);
  });

  it("no falla con símbolos que la tipografía no tiene (emojis, flechas, otros alfabetos)", async () => {
    const rows = [["09:00", "Ana 😀 → Zoë 日本語", "Línea 1\nLínea 2\nLínea 3\nLínea 4\nLínea 5"]];
    expect(await pagesOf(await buildAgendaPdf({ ...base, rows }))).toBe(1);
  });

  it("no falla con palabras larguísimas ni con textos muy largos en una celda", async () => {
    const rows = [["09:00", "x".repeat(500), "palabra ".repeat(300)]];
    expect(await pagesOf(await buildAgendaPdf({ ...base, rows }))).toBe(1);
  });
});
