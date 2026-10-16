import { describe, expect, it } from "vitest";
import { ageInYears, monthEnd, monthStart, periodKey, weekEnd, weekStart, widenRange } from "./periods";

describe("períodos de calendario", () => {
  it("la semana va de lunes a domingo", () => {
    expect(weekStart("2030-01-07")).toBe("2030-01-07"); // lunes
    expect(weekStart("2030-01-09")).toBe("2030-01-07"); // miércoles
    expect(weekStart("2030-01-13")).toBe("2030-01-07"); // domingo pertenece a la semana que termina
    expect(weekStart("2030-01-14")).toBe("2030-01-14"); // el lunes siguiente arranca otra semana
    expect(weekEnd("2030-01-09")).toBe("2030-01-13");
  });

  it("una semana puede cruzar el cambio de mes y de año", () => {
    expect(weekStart("2030-02-01")).toBe("2030-01-28");
    expect(weekEnd("2030-01-30")).toBe("2030-02-03");
    expect(weekStart("2031-01-01")).toBe("2030-12-30");
  });

  it("calcula inicio y fin de mes, incluyendo años bisiestos", () => {
    expect(monthStart("2030-02-10")).toBe("2030-02-01");
    expect(monthEnd("2030-02-10")).toBe("2030-02-28");
    expect(monthEnd("2032-02-01")).toBe("2032-02-29");
    expect(monthEnd("2030-12-15")).toBe("2030-12-31");
  });

  it("identifica el período de cada fecha", () => {
    expect(periodKey("DAY", "2030-01-09")).toBe("2030-01-09");
    expect(periodKey("WEEK", "2030-01-09")).toBe("2030-01-07");
    expect(periodKey("MONTH", "2030-01-09")).toBe("2030-01");
  });

  it("amplía el rango para contar semanas y meses completos", () => {
    expect(widenRange("2030-02-01", "2030-02-10")).toEqual({ from: "2030-01-28", to: "2030-02-28" });
    expect(widenRange("2030-01-07", "2030-01-13")).toEqual({ from: "2030-01-01", to: "2030-01-31" });
  });
});

describe("edad", () => {
  it("cuenta años cumplidos a la fecha del turno", () => {
    expect(ageInYears("2012-01-07", "2030-01-07")).toBe(18); // cumple ese mismo día
    expect(ageInYears("2012-01-08", "2030-01-07")).toBe(17); // cumple mañana
    expect(ageInYears("2012-02-29", "2030-02-28")).toBe(17);
    expect(ageInYears("2030-01-07", "2030-01-07")).toBe(0);
  });
});
