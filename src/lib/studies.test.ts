import { describe, expect, it } from "vitest";
import { mergeRequirements, studyInstructionLines } from "./studies";

describe("studyInstructionLines", () => {
  it("separa por línea, recorta y descarta las vacías", () => {
    expect(studyInstructionLines("DNI\n\n  Venir en ayunas  \n")).toEqual(["DNI", "Venir en ayunas"]);
  });

  it("acepta saltos de línea de Windows", () => {
    expect(studyInstructionLines("DNI\r\nOrden de la empresa")).toEqual(["DNI", "Orden de la empresa"]);
  });

  it("devuelve una lista vacía si no hay texto", () => {
    expect(studyInstructionLines(null)).toEqual([]);
    expect(studyInstructionLines("")).toEqual([]);
  });
});

describe("mergeRequirements", () => {
  it("no repite lo que piden la regla y el estudio (sin distinguir mayúsculas ni espacios)", () => {
    expect(mergeRequirements(["DNI", "Nota de la empresa"], ["dni ", "Venir en ayunas"])).toEqual(["DNI", "Nota de la empresa", "Venir en ayunas"]);
  });

  it("mantiene el orden y tolera listas vacías", () => {
    expect(mergeRequirements([], ["B", "A"], [])).toEqual(["B", "A"]);
  });
});
