import { afterEach, describe, expect, it, vi } from "vitest";
import { birthDateSchema } from "./validation";

describe("birthDateSchema", () => {
  afterEach(() => vi.useRealTimers());

  it("usa el 'hoy' de Argentina, no el de UTC", () => {
    // 21/10 22:00 en Buenos Aires = 22/10 01:00 en UTC.
    vi.useFakeTimers({ now: new Date("2026-10-22T01:00:00Z") });
    expect(birthDateSchema.safeParse("2026-10-21").success).toBe(true);
    expect(birthDateSchema.safeParse("2026-10-22").success).toBe(false);
  });

  it("rechaza fechas futuras y anteriores a 1900", () => {
    vi.useFakeTimers({ now: new Date("2026-10-22T15:00:00Z") });
    expect(birthDateSchema.safeParse("2026-10-23").success).toBe(false);
    expect(birthDateSchema.safeParse("1899-12-31").success).toBe(false);
    expect(birthDateSchema.safeParse("1990-05-17").success).toBe(true);
  });
});
