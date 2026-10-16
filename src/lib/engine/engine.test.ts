import { describe, expect, it } from "vitest";
import { minutesToTime, zonedTimeToUtc } from "@/lib/time";
import { evaluarAgenda, primerTurnoDisponible, resolveRule, turnosDisponibles, verificarTurno } from "./engine";
import type { Block, EngineInput, Exception, ExistingAppointment, Quota, Rule, SlotStatus } from "./types";

// ───────────────────────── Datos de prueba ─────────────────────────
// Semana de prueba: lunes 2030-01-07 a domingo 2030-01-13.
// Dr. Pérez atiende lunes, miércoles y viernes de 9 a 13, turnos de 20 minutos.
//   PAMI:       lun/mié 9-11, máx. 2 por día y 6 por semana
//   OSDE:       lun/mié/vie 9-11, primera vez de 40 minutos
//   Particular: lun/mié/vie 11-13

const TZ = "America/Argentina/Buenos_Aires";
const MON = "2030-01-07";
const WED = "2030-01-09";
const FRI = "2030-01-11";
const NEXT_MON = "2030-01-14";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

const dayQuota: Quota = { id: "q-day", period: "DAY", max: 2, scope: "PROFESSIONAL", weekdays: null };
const weekQuota: Quota = { id: "q-week", period: "WEEK", max: 6, scope: "PROFESSIONAL", weekdays: null };

function rule(partial: Partial<Rule> & Pick<Rule, "id" | "coverageId">): Rule {
  return {
    professionalId: "perez",
    specialtyId: null,
    active: true,
    firstVisitMinutes: null,
    controlMinutes: null,
    windows: [],
    quotas: [],
    requirements: [],
    ...partial,
  };
}

const pamiRule = rule({
  id: "r-pami",
  coverageId: "pami",
  windows: [1, 3].map((weekday) => ({ weekday, startMinutes: h(9), endMinutes: h(11) })),
  quotas: [dayQuota, weekQuota],
  requirements: ["Orden PAMI vigente", "DNI y credencial"],
});
const osdeRule = rule({
  id: "r-osde",
  coverageId: "osde",
  firstVisitMinutes: 40,
  windows: [1, 3, 5].map((weekday) => ({ weekday, startMinutes: h(9), endMinutes: h(11) })),
});
const particularRule = rule({
  id: "r-part",
  coverageId: "particular",
  windows: [1, 3, 5].map((weekday) => ({ weekday, startMinutes: h(11), endMinutes: h(13) })),
});

const agendaBlocks: Block[] = [1, 3, 5].map((weekday) => ({
  id: `b-${weekday}`,
  weekday,
  startMinutes: h(9),
  endMinutes: h(13),
  slotMinutes: 20,
  officeId: "c1",
  active: true,
  validFrom: null,
  validTo: null,
}));

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    professional: { id: "perez", specialtyId: "trauma" },
    coverageId: "pami",
    visitType: "CONTROL",
    range: { from: MON, to: "2030-01-13" },
    now: new Date("2030-01-01T12:00:00Z"),
    timezone: TZ,
    limits: null,
    blocks: agendaBlocks,
    rules: [pamiRule, osdeRule, particularRule],
    exceptions: [],
    appointments: [],
    ...overrides,
  };
}

let seq = 0;
function appt(date: string, startMinutes: number, extra: Partial<ExistingAppointment> = {}): ExistingAppointment {
  return {
    id: `a${++seq}`,
    professionalId: "perez",
    specialtyId: "trauma",
    coverageId: "pami",
    startsAt: zonedTimeToUtc(date, startMinutes, TZ),
    endsAt: zonedTimeToUtc(date, startMinutes + 20, TZ),
    localDate: date,
    status: "CONFIRMED",
    ...extra,
  };
}

/** Horarios disponibles de un día, como "09:00". */
function free(inp: EngineInput, date: string) {
  const day = turnosDisponibles(inp).days.find((d) => d.date === date);
  return (day?.slots ?? []).map((s) => minutesToTime(s.startMinutes));
}

function statusAt(inp: EngineInput, date: string, startMinutes: number): SlotStatus | undefined {
  return verificarTurno(inp, date, startMinutes)?.status;
}

function statusesOf(inp: EngineInput, date: string) {
  const day = evaluarAgenda(inp).days.find((d) => d.date === date)!;
  return new Set(day.slots.map((s) => s.status));
}

// ───────────────────────── Tests ─────────────────────────

describe("agenda base y ventanas de la cobertura", () => {
  it("genera la grilla del bloque y deja solo la ventana de PAMI (lun/mié 9 a 11)", () => {
    const inp = input();
    expect(free(inp, MON)).toEqual(["09:00", "09:20", "09:40", "10:00", "10:20", "10:40"]);
    expect(free(inp, WED)).toHaveLength(6);
  });

  it("PAMI no se atiende los viernes ni los días sin bloque", () => {
    const inp = input();
    expect(free(inp, FRI)).toEqual([]);
    expect(free(inp, "2030-01-08")).toEqual([]); // martes: el profesional no atiende
    expect(statusAt(inp, FRI, h(9))).toBe("OUTSIDE_WINDOW");
  });

  it("fuera de franja: OSDE es de 9 a 11 y Particular de 11 a 13", () => {
    expect(statusAt(input({ coverageId: "osde" }), MON, h(11))).toBe("OUTSIDE_WINDOW");
    expect(statusAt(input({ coverageId: "particular" }), MON, h(10, 40))).toBe("OUTSIDE_WINDOW");
    expect(free(input({ coverageId: "particular" }), MON)).toEqual(["11:00", "11:20", "11:40", "12:00", "12:20", "12:40"]);
  });

  it("los horarios salen en UTC correctos para la zona del centro (9:00 en Buenos Aires = 12:00Z)", () => {
    const slot = verificarTurno(input(), MON, h(9))!;
    expect(slot.startsAt.toISOString()).toBe("2030-01-07T12:00:00.000Z");
    expect(slot.endsAt.toISOString()).toBe("2030-01-07T12:20:00.000Z");
    expect(slot.officeId).toBe("c1");
  });

  it("devuelve los requisitos de la cobertura elegida", () => {
    expect(turnosDisponibles(input()).requirements).toEqual(["Orden PAMI vigente", "DNI y credencial"]);
    expect(turnosDisponibles(input({ coverageId: "osde" })).requirements).toEqual([]);
  });

  it("un horario que no está en la grilla no existe", () => {
    expect(verificarTurno(input(), MON, h(9, 10))).toBeNull();
  });

  it("ignora bloques inactivos y fuera de su vigencia", () => {
    const monday = agendaBlocks[0];
    expect(free(input({ blocks: [{ ...monday, active: false }] }), MON)).toEqual([]);
    expect(free(input({ blocks: [{ ...monday, validFrom: "2030-02-01" }] }), MON)).toEqual([]);
    expect(free(input({ blocks: [{ ...monday, validTo: "2030-01-06" }] }), MON)).toEqual([]);
    expect(free(input({ blocks: [{ ...monday, validFrom: MON, validTo: MON }] }), MON)).toHaveLength(6);
  });

  it("si dos bloques se superponen no repite horarios", () => {
    const a = { ...agendaBlocks[0], id: "a", startMinutes: h(9), endMinutes: h(11) };
    const b = { ...agendaBlocks[0], id: "b", startMinutes: h(10), endMinutes: h(12) };
    const starts = evaluarAgenda(input({ blocks: [a, b] })).days[0].slots.map((s) => s.startMinutes);
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("excepciones: feriados, licencias y bloqueos", () => {
  const holiday: Exception = {
    id: "e-holiday", kind: "HOLIDAY", professionalId: null,
    dateFrom: MON, dateTo: MON, startMinutes: null, endMinutes: null,
  };

  it("un feriado del centro cierra todos los horarios de ese día", () => {
    const inp = input({ exceptions: [holiday] });
    expect(free(inp, MON)).toEqual([]);
    expect(free(inp, WED)).toHaveLength(6);
    const day = evaluarAgenda(inp).days[0];
    expect(day.closedBy).toEqual({ id: "e-holiday", kind: "HOLIDAY" });
    expect(statusesOf(inp, MON)).toEqual(new Set(["EXCEPTION"]));
  });

  it("una licencia de varios días solo afecta al profesional que la tiene", () => {
    const leave: Exception = { ...holiday, id: "e-leave", kind: "LEAVE", professionalId: "perez", dateFrom: MON, dateTo: WED };
    const others: Exception = { ...leave, id: "e-other", professionalId: "otro" };
    expect(free(input({ exceptions: [leave] }), MON)).toEqual([]);
    expect(free(input({ exceptions: [leave] }), WED)).toEqual([]);
    expect(free(input({ exceptions: [others] }), MON)).toHaveLength(6);
  });

  it("un bloqueo parcial saca solo los horarios que se superponen", () => {
    const block: Exception = { ...holiday, id: "e-block", kind: "BLOCK", professionalId: "perez", startMinutes: h(10), endMinutes: h(10, 30) };
    expect(free(input({ exceptions: [block] }), MON)).toEqual(["09:00", "09:20", "09:40", "10:40"]);
  });
});

describe("horarios ocupados", () => {
  it("un turno de cualquier cobertura ocupa el horario para todas", () => {
    const osdeAppt = appt(MON, h(9), { coverageId: "osde" });
    expect(statusAt(input({ appointments: [osdeAppt] }), MON, h(9))).toBe("OCCUPIED");
    expect(free(input({ appointments: [osdeAppt] }), MON)).not.toContain("09:00");
  });

  it("el turno de otro profesional no ocupa este horario", () => {
    const other = appt(MON, h(9), { professionalId: "otro" });
    expect(free(input({ appointments: [other] }), MON)).toContain("09:00");
  });

  it("una primera vez de 40 minutos no puede pisar el turno siguiente", () => {
    const control = appt(MON, h(9, 20), { coverageId: "osde" });
    const inp = input({ coverageId: "osde", visitType: "FIRST", appointments: [control] });
    expect(statusAt(inp, MON, h(9))).toBe("OCCUPIED"); // 9:00-9:40 choca con 9:20-9:40
    expect(statusAt(inp, MON, h(9, 40))).toBe("AVAILABLE");
  });
});

describe("duración especial de primera vez", () => {
  it("la primera vez dura 40 y debe entrar completa en la ventana", () => {
    const inp = input({ coverageId: "osde", visitType: "FIRST" });
    expect(free(inp, MON)).toEqual(["09:00", "09:20", "09:40", "10:00", "10:20"]);
    expect(verificarTurno(inp, MON, h(9))!.durationMinutes).toBe(40);
    expect(statusAt(inp, MON, h(10, 40))).toBe("OUTSIDE_WINDOW"); // terminaría 11:20, pasada la ventana
  });

  it("el control usa la duración del bloque", () => {
    expect(verificarTurno(input({ coverageId: "osde", visitType: "CONTROL" }), MON, h(9))!.durationMinutes).toBe(20);
  });

  it("no se ofrecen horarios cuyo turno no entra en el bloque", () => {
    const short = { ...agendaBlocks[0], endMinutes: h(9, 50) };
    const inp = input({ coverageId: "osde", visitType: "FIRST", blocks: [short] });
    expect(free(inp, MON)).toEqual(["09:00"]); // 9:20 + 40 = 10:00 > 9:50
  });
});

describe("cupos", () => {
  it("cupo diario lleno: PAMI se cierra ese día pero no los otros días ni las otras coberturas", () => {
    const full = [appt(MON, h(9)), appt(MON, h(9, 20))];
    const inp = input({ appointments: full });

    expect(free(inp, MON)).toEqual([]);
    expect(statusAt(inp, MON, h(10))).toBe("QUOTA_FULL");
    expect(verificarTurno(inp, MON, h(10))!.quotaId).toBe("q-day");
    expect(free(inp, WED)).toHaveLength(6); // el cupo diario no pasa al día siguiente

    // OSDE no tiene cupo: sigue atendiendo el lunes en los horarios libres
    expect(free(input({ coverageId: "osde", appointments: full }), MON)).toEqual(["09:40", "10:00", "10:20", "10:40"]);
  });

  it("cupo semanal lleno: se cierran todos los días de esa semana, no la siguiente", () => {
    const weekly = rule({ ...pamiRule, quotas: [{ ...dayQuota, max: 5 }, { ...weekQuota, max: 3 }] });
    const appointments = [appt(MON, h(9)), appt(MON, h(9, 20)), appt(WED, h(9))];
    const inp = input({ rules: [weekly], appointments, range: { from: MON, to: "2030-01-20" } });

    expect(free(inp, WED)).toEqual([]);
    expect(statusAt(inp, WED, h(10))).toBe("QUOTA_FULL");
    expect(verificarTurno(inp, WED, h(10))!.quotaId).toBe("q-week");
    expect(free(inp, NEXT_MON)).toHaveLength(6);
  });

  it("varios cupos a la vez: el día puede estar lleno mientras la semana tiene lugar", () => {
    const inp = input({ appointments: [appt(MON, h(9)), appt(MON, h(9, 20)), appt(WED, h(9))] });
    const monday = evaluarAgenda(inp).days.find((d) => d.date === MON)!;
    const wednesday = evaluarAgenda(inp).days.find((d) => d.date === WED)!;

    expect(monday.quotas.map((q) => [q.period, q.used, q.max, q.full])).toEqual([
      ["DAY", 2, 2, true],
      ["WEEK", 3, 6, false],
    ]);
    expect(wednesday.quotas.map((q) => [q.period, q.used, q.max, q.full])).toEqual([
      ["DAY", 1, 2, false],
      ["WEEK", 3, 6, false],
    ]);
    expect(free(inp, WED)).toHaveLength(5); // el miércoles sigue habiendo lugar (menos el 9:00 ocupado)
  });

  it("los contadores quedan disponibles para mostrarlos a secretaría", () => {
    const counters = evaluarAgenda(input({ appointments: [appt(MON, h(9))] })).days[0].quotas;
    expect(counters).toEqual([
      { quotaId: "q-day", period: "DAY", scope: "PROFESSIONAL", periodKey: MON, max: 2, used: 1, full: false },
      { quotaId: "q-week", period: "WEEK", scope: "PROFESSIONAL", periodKey: MON, max: 6, used: 1, full: false },
    ]);
  });

  it("un turno cancelado libera el cupo y también el horario", () => {
    const cancelled = appt(MON, h(9), { status: "CANCELLED" });
    const active = appt(MON, h(9, 20));
    const inp = input({ appointments: [cancelled, active] });

    const monday = evaluarAgenda(inp).days[0];
    expect(monday.quotas[0]).toMatchObject({ used: 1, full: false });
    expect(free(inp, MON)).toContain("09:00");
  });

  it("al cancelar uno de los dos turnos del día, ese día vuelve a tener cupo", () => {
    const both = [appt(MON, h(9)), appt(MON, h(9, 20))];
    expect(free(input({ appointments: both }), MON)).toEqual([]);

    const afterCancel = [{ ...both[0], status: "CANCELLED" }, both[1]];
    expect(free(input({ appointments: afterCancel }), MON)).toEqual(["09:00", "09:40", "10:00", "10:20", "10:40"]);
  });

  it("reservado, confirmado, ausente y atendido consumen cupo", () => {
    for (const status of ["RESERVED", "CONFIRMED", "NO_SHOW", "ATTENDED"]) {
      const appointments = [appt(MON, h(9), { status }), appt(MON, h(9, 20), { status })];
      expect(free(input({ appointments }), MON), status).toEqual([]);
    }
  });

  it("un sobreturno cuenta como cualquier otro turno en los contadores", () => {
    // Dos turnos en la misma hora (uno es sobreturno): ambos consumen cupo.
    const monday = evaluarAgenda(input({ appointments: [appt(MON, h(9)), appt(MON, h(9))] })).days[0];
    expect(monday.quotas[0]).toMatchObject({ used: 2, full: true });
  });

  it("un cupo con días puntuales solo rige esos días", () => {
    const wedOnly = rule({ ...pamiRule, quotas: [{ id: "q-wed", period: "DAY", max: 1, scope: "PROFESSIONAL", weekdays: [3] }] });
    const inp = input({ rules: [wedOnly], appointments: [appt(MON, h(9)), appt(WED, h(9))] });

    expect(free(inp, MON)).toHaveLength(5); // lunes sin cupo: solo se descuenta el horario ocupado
    expect(evaluarAgenda(inp).days[0].quotas).toEqual([]);
    expect(free(inp, WED)).toEqual([]); // miércoles: cupo de 1 ya usado
  });

  it("un cupo semanal con días puntuales solo cuenta los turnos de esos días", () => {
    const monOnly = rule({ ...pamiRule, quotas: [{ id: "q-mon", period: "WEEK", max: 1, scope: "PROFESSIONAL", weekdays: [1] }] });
    const inp = input({ rules: [monOnly], appointments: [appt(WED, h(9)), appt(MON, h(9))] });

    expect(statusAt(inp, MON, h(10))).toBe("QUOTA_FULL");
    expect(free(inp, WED)).toHaveLength(5); // el miércoles no está sujeto a ese cupo
  });

  it("cupo mensual: se reinicia al cambiar de mes", () => {
    const monthly = rule({ ...pamiRule, quotas: [{ id: "q-month", period: "MONTH", max: 3, scope: "PROFESSIONAL", weekdays: null }] });
    const appointments = [appt("2030-01-21", h(9)), appt("2030-01-28", h(9)), appt("2030-01-30", h(9))];
    const inp = input({ rules: [monthly], appointments, range: { from: "2030-01-28", to: "2030-02-06" } });

    expect(free(inp, "2030-01-28")).toEqual([]); // enero ya tiene 3
    expect(free(inp, "2030-02-04")).toHaveLength(6); // febrero empieza en cero
  });

  it("la semana de calendario cruza el cambio de mes", () => {
    // Semana del lunes 28/01 al domingo 03/02: 1 turno el miércoles 30/01 y 1 el viernes 01/02.
    const weekly = rule({ ...osdeRule, quotas: [{ id: "q-w2", period: "WEEK", max: 2, scope: "PROFESSIONAL", weekdays: null }] });
    const appointments = [
      appt("2030-01-30", h(9), { coverageId: "osde" }),
      appt("2030-02-01", h(9), { coverageId: "osde" }),
    ];
    const inp = input({ coverageId: "osde", rules: [weekly], appointments, range: { from: "2030-01-28", to: "2030-02-06" } });

    expect(free(inp, "2030-01-28")).toEqual([]); // lunes de esa misma semana
    expect(free(inp, "2030-02-04")).not.toEqual([]); // la semana siguiente vuelve a estar libre
  });

  describe("alcance del cupo", () => {
    const shared = (scope: Quota["scope"]) =>
      rule({ ...pamiRule, quotas: [{ id: "q-shared", period: "DAY", max: 1, scope, weekdays: null }] });
    const otherDoctor = appt(MON, h(9), { professionalId: "otro", specialtyId: "trauma" });
    const otherSpecialty = appt(MON, h(9), { professionalId: "neuro", specialtyId: "neurologia" });

    it("por profesional: lo que atiende otro profesional no cuenta", () => {
      expect(free(input({ rules: [shared("PROFESSIONAL")], appointments: [otherDoctor] }), MON)).toHaveLength(6);
    });

    it("por especialidad: cuentan los colegas de la misma especialidad, no los de otra", () => {
      expect(free(input({ rules: [shared("SPECIALTY")], appointments: [otherDoctor] }), MON)).toEqual([]);
      expect(free(input({ rules: [shared("SPECIALTY")], appointments: [otherSpecialty] }), MON)).toHaveLength(6);
    });

    it("compartido por todo el centro: cuenta cualquier profesional", () => {
      expect(free(input({ rules: [shared("CENTER")], appointments: [otherSpecialty] }), MON)).toEqual([]);
    });

    it("el cupo es por cobertura: turnos de otra cobertura no cuentan", () => {
      const osdeAppt = appt(MON, h(9), { professionalId: "otro", coverageId: "osde" });
      expect(free(input({ rules: [shared("CENTER")], appointments: [osdeAppt] }), MON)).toHaveLength(6);
    });
  });

  it("al reprogramar, el turno que se mueve no cuenta contra sí mismo", () => {
    const both = [appt(MON, h(9)), appt(MON, h(9, 20))];
    expect(free(input({ appointments: both }), MON)).toEqual([]);

    const moving = input({ appointments: both, excludeAppointmentId: both[0].id });
    expect(free(moving, MON)).toContain("09:00");
    expect(evaluarAgenda(moving).days[0].quotas[0]).toMatchObject({ used: 1, full: false });
  });
});

describe("reglas por profesional y por especialidad", () => {
  const swissSpecialty = rule({
    id: "r-swiss-esp", coverageId: "swiss", professionalId: null, specialtyId: "trauma",
    windows: [{ weekday: 1, startMinutes: h(9), endMinutes: h(13) }],
  });
  const swissOwn = rule({
    id: "r-swiss-own", coverageId: "swiss",
    windows: [{ weekday: 1, startMinutes: h(9), endMinutes: h(10) }],
  });

  it("aplica la regla de la especialidad cuando el profesional no tiene la suya", () => {
    const inp = input({ coverageId: "swiss", rules: [swissSpecialty] });
    expect(resolveRule(inp)?.id).toBe("r-swiss-esp");
    expect(free(inp, MON)).toHaveLength(12);
  });

  it("la regla del profesional pisa a la de la especialidad", () => {
    const inp = input({ coverageId: "swiss", rules: [swissSpecialty, swissOwn] });
    expect(resolveRule(inp)?.id).toBe("r-swiss-own");
    expect(free(inp, MON)).toEqual(["09:00", "09:20", "09:40"]);
  });

  it("si la regla del profesional está inactiva, esa cobertura no se atiende", () => {
    const inp = input({ coverageId: "swiss", rules: [swissSpecialty, { ...swissOwn, active: false }] });
    expect(resolveRule(inp)).toBeNull();
    expect(free(inp, MON)).toEqual([]);
  });

  it("sin regla para la cobertura, el profesional no la atiende", () => {
    const inp = input({ coverageId: "swiss" });
    expect(turnosDisponibles(inp)).toEqual({ requirements: [], days: [] });
    expect(statusesOf(inp, MON)).toEqual(new Set(["NO_RULE"]));
  });

  it("una regla de la especialidad de otro profesional no aplica", () => {
    const otherSpecialty = { ...swissSpecialty, specialtyId: "neurologia" };
    expect(free(input({ coverageId: "swiss", rules: [otherSpecialty] }), MON)).toEqual([]);
  });
});

describe("tiempo: pasado, anticipación y horizonte", () => {
  it("nunca ofrece horarios que ya pasaron", () => {
    // 10:10 hora local del lunes
    const now = zonedTimeToUtc(MON, h(10, 10), TZ);
    expect(free(input({ now }), MON)).toEqual(["10:20", "10:40"]);
    expect(statusAt(input({ now }), MON, h(10))).toBe("PAST");
  });

  it("respeta la anticipación mínima del turnero online, no la de secretaría", () => {
    const now = zonedTimeToUtc(MON, h(8), TZ);
    const online = input({ now, limits: { minNoticeHours: 2, horizonDays: 60 } });
    expect(free(online, MON)).toEqual(["10:00", "10:20", "10:40"]);
    expect(statusAt(online, MON, h(9))).toBe("NOTICE");
    expect(free(input({ now }), MON)).toHaveLength(6); // sin límites: se puede dar turno ya
  });

  it("respeta el horizonte de reserva online", () => {
    const now = zonedTimeToUtc(MON, h(8), TZ);
    const online = input({ now, limits: { minNoticeHours: 0, horizonDays: 3 }, range: { from: MON, to: NEXT_MON } });
    expect(free(online, WED)).toHaveLength(6);
    expect(free(online, NEXT_MON)).toEqual([]);
    expect(statusAt(online, NEXT_MON, h(9))).toBe("BEYOND_HORIZON");
  });
});

describe("rango de edad de la especialidad", () => {
  const pediatrics = { minAgeYears: 0, maxAgeYears: 17 };

  it("acepta a un menor de 18 y rechaza a quien ya cumplió 18", () => {
    const minor = input({ specialty: pediatrics, patient: { birthDate: "2012-01-08" } }); // 17 años
    const adult = input({ specialty: pediatrics, patient: { birthDate: "2012-01-07" } }); // cumple 18 el lunes
    expect(free(minor, MON)).toHaveLength(6);
    expect(free(adult, MON)).toEqual([]);
    expect(statusAt(adult, MON, h(9))).toBe("AGE");
  });

  it("evalúa la edad a la fecha de cada turno (cumple 18 durante la semana)", () => {
    const inp = input({ specialty: pediatrics, patient: { birthDate: "2012-01-08" } });
    expect(free(inp, MON)).toHaveLength(6); // 17 años
    expect(free(inp, WED)).toEqual([]); // ya cumplió 18
  });

  it("sin datos del paciente no se valida la edad", () => {
    expect(free(input({ specialty: pediatrics }), MON)).toHaveLength(6);
  });
});

describe("verificarTurno: la misma regla al guardar", () => {
  it("devuelve el estado de un horario puntual, igual que la vista", () => {
    const full = [appt(MON, h(9)), appt(MON, h(9, 20))];
    expect(statusAt(input(), MON, h(10))).toBe("AVAILABLE");
    expect(statusAt(input({ appointments: full }), MON, h(10))).toBe("QUOTA_FULL");
    expect(statusAt(input({ appointments: full }), MON, h(9))).toBe("OCCUPIED");
  });

  it("nunca contradice a turnosDisponibles", () => {
    const inp = input({
      appointments: [appt(MON, h(9)), appt(MON, h(9, 20)), appt(WED, h(10))],
      exceptions: [{ id: "e", kind: "BLOCK", professionalId: "perez", dateFrom: WED, dateTo: WED, startMinutes: h(9), endMinutes: h(9, 30) }],
    });
    const offered = new Set(
      turnosDisponibles(inp).days.flatMap((d) => d.slots.map((s) => `${d.date} ${s.startMinutes}`)),
    );
    for (const day of evaluarAgenda(inp).days) {
      for (const slot of day.slots) {
        const key = `${day.date} ${slot.startMinutes}`;
        expect(verificarTurno(inp, day.date, slot.startMinutes)!.status === "AVAILABLE", key).toBe(offered.has(key));
      }
    }
  });

  it("primerTurnoDisponible devuelve el próximo horario libre", () => {
    const full = [appt(MON, h(9)), appt(MON, h(9, 20))];
    const first = primerTurnoDisponible(turnosDisponibles(input({ appointments: full })));
    expect(first).toMatchObject({ date: WED, startMinutes: h(9) });
    expect(primerTurnoDisponible(turnosDisponibles(input({ coverageId: "swiss" })))).toBeNull();
  });
});

describe("todas las reglas incumplidas de un horario", () => {
  it("informa cada regla que se salta, no solo la primera (para registrar overrides)", () => {
    // Lunes 11:00 con PAMI: fuera de la franja de PAMI (9-11), con el cupo del día lleno y otro turno encima.
    const full = [appt(MON, h(9)), appt(MON, h(9, 20)), appt(MON, h(11), { coverageId: "osde" })];
    const slot = verificarTurno(input({ appointments: full }), MON, h(11))!;
    expect(slot.status).toBe("OUTSIDE_WINDOW");
    expect(slot.violations).toEqual(["OUTSIDE_WINDOW", "OCCUPIED", "QUOTA_FULL"]);
  });

  it("un horario disponible no tiene reglas incumplidas", () => {
    expect(verificarTurno(input(), MON, h(9))!.violations).toEqual([]);
  });

  it("un feriado también marca el cupo si estaba lleno", () => {
    const holiday: Exception = { id: "e", kind: "HOLIDAY", professionalId: null, dateFrom: MON, dateTo: MON, startMinutes: null, endMinutes: null };
    const slot = verificarTurno(input({ exceptions: [holiday], appointments: [appt(MON, h(9)), appt(MON, h(9, 20))] }), MON, h(10))!;
    expect(slot.violations).toEqual(["EXCEPTION", "QUOTA_FULL"]);
    expect(slot.exceptionId).toBe("e");
  });
});
