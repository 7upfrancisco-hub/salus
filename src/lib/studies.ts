/** Indicaciones de un estudio preocupacional (qué traer, cómo prepararse): una por línea, sin líneas vacías. */
export function studyInstructionLines(instructions: string | null | undefined) {
  return (instructions ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Une listas de requisitos sin repetir (ignora mayúsculas y espacios): la regla de la cobertura y el estudio suelen pedir lo mismo, como el DNI. */
export function mergeRequirements(...lists: string[][]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of lists.flat()) {
    const text = item.trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      merged.push(text);
    }
  }
  return merged;
}
