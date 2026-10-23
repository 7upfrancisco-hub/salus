/**
 * Prueba de punta a punta: maneja un navegador real (Chrome o Edge instalado) contra el servidor de
 * desarrollo y hace lo que haría una persona, tanto del lado del paciente como de secretaría.
 * Requiere el servidor corriendo (npm run dev -- -p 3001) y los datos de ejemplo del seed.
 *
 *   npm run check:ui
 *
 * Crea turnos de prueba con DNI que empiezan con 9100 y los borra al terminar.
 */
import { existsSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { chromium, type Page } from "playwright-core";
import { db } from "../src/lib/db";
import { addDaysToDate, todayInZone, weekdayOf, zonedTimeToUtc } from "../src/lib/time";

const startedAt = new Date();
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) throw new Error("No encontré Chrome ni Edge instalados");

let failures = 0;
const ok = (label: string, condition: boolean, detail = "") => {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "✔" : "✘"} ${label}${!condition && detail ? `  → ${detail}` : ""}`);
};

const settings = (await db.centerSettings.findUnique({ where: { id: 1 } }))!;
const today = todayInZone(settings.timezone);
let monday = addDaysToDate(today, 4);
while (weekdayOf(monday) !== 1) monday = addDaysToDate(monday, 1);

let tuesday = addDaysToDate(today, 4);
while (weekdayOf(tuesday) !== 2) tuesday = addDaysToDate(tuesday, 1);

const perez = await db.professional.findFirstOrThrow({ where: { name: "Dr. Pérez" } });
const medina = await db.professional.findFirstOrThrow({ where: { name: "Dra. Medina" } });
const ruiz = await db.professional.findFirstOrThrow({ where: { name: "Dr. Ruiz" } });
const pamiRule = await db.coverageRule.findFirstOrThrow({ where: { professionalId: perez.id, coverage: { name: "PAMI" } } });

// El límite de pedidos se guarda en la base: sin esto, corridas seguidas se bloquean entre sí (8 reservas por 10 minutos).
await db.rateLimitHit.deleteMany();

const browser = await chromium.launch({ executablePath, headless: true });

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/agenda**");
}

/** Entra al turnero y elige el camino "Personal" (la primera pregunta es personal o preocupacional). */
async function openPersonal(page: Page) {
  await page.goto(BASE);
  await page.getByRole("button", { name: /^Personal/ }).click();
}

/** Descarga un PDF con un clic y devuelve su nombre y cuántas páginas tiene. */
async function downloadPdf(page: Page, linkName: string) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: linkName }).click()]);
  const bytes = readFileSync((await download.path())!);
  const valid = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  return { filename: download.suggestedFilename(), valid, pages: valid ? (await PDFDocument.load(bytes)).getPageCount() : 0 };
}

async function fillPatient(page: Page, n: number, extra: { birthDate?: string } = {}) {
  await page.getByLabel("Nombre", { exact: true }).fill("Prueba");
  await page.getByLabel("Apellido").fill(`Navegador${n}`);
  await page.getByLabel(/DNI/).first().fill(`9100${String(n).padStart(4, "0")}`);
  await page.getByLabel("Fecha de nacimiento").fill(extra.birthDate ?? "1958-04-12");
  await page.getByLabel("Email").fill(`navegador${n}@example.com`);
  await page.getByLabel(/Teléfono/).fill("11 2345 6789");
}

let appointmentUrl = "";

try {
  // ───────────────────────── Paciente ─────────────────────────
  console.log("\nPaciente: reserva online");
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); // celular
    page.setDefaultTimeout(30_000);
    await page.goto(BASE);
    ok(
      "la entrada pregunta si el turno es personal o preocupacional",
      (await page.getByRole("button", { name: /^Personal/ }).count()) === 1 && (await page.getByRole("button", { name: /^Preocupacional/ }).count()) === 1,
    );
    ok("hasta elegir el tipo de turno no muestra coberturas", (await page.getByRole("button", { name: "PAMI" }).count()) === 0);
    await page.getByRole("button", { name: /^Personal/ }).click();
    ok("la página pública muestra las coberturas", (await page.getByRole("button", { name: "PAMI" }).count()) > 0);
    ok("la cobertura Preocupacional no aparece entre las coberturas", (await page.getByRole("button", { name: "Preocupacional", exact: true }).count()) === 0);

    await page.getByRole("button", { name: "PAMI" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    ok("ofrece especialidades de PAMI, no las que no atienden PAMI", (await page.getByRole("button", { name: "Pediatría" }).count()) === 0);

    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    ok("al elegir el médico todavía no muestra la agenda", (await page.getByText("Próximo turno disponible").count()) === 0);
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText("Próximo turno disponible").waitFor();
    ok("con «Buscar turno» muestra el próximo turno disponible", true);

    // Se elige el lunes a propósito: las verificaciones de secretaría de más abajo miran ese día
    // (el primer día con lugar cambia según cuándo se corra la prueba).
    await page.getByRole("button", { name: dayLabel(monday), exact: true }).click();
    // Solo los horarios de la grilla (el atajo "Próximo turno disponible" también contiene una hora).
    const slots = page.locator("div.grid button[aria-pressed]").filter({ hasText: /\d{2}:\d{2} hs/ });
    ok("lista horarios del día elegido", (await slots.count()) > 0);
    const slotText = (await slots.first().innerText()).trim();
    await slots.first().click();

    await page.getByText("Para este turno tenés que traer:").waitFor();
    ok("muestra los requisitos de PAMI antes de confirmar", (await page.getByText("Orden PAMI vigente").count()) > 0);

    await fillPatient(page, 1);
    await page.getByRole("button", { name: "Confirmar turno" }).click();
    await page.getByText("Tenés que aceptar").waitFor();
    ok("exige aceptar el uso de los datos (no reserva sin tildar)", page.url() === BASE + "/");
    ok("si hay un error, no borra lo que la persona ya escribió", (await page.getByLabel("Apellido").inputValue()) === "Navegador1");

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirmar turno" }).click();
    await page.waitForURL("**/turno/**");
    appointmentUrl = page.url();
    ok(`reserva el turno (${slotText}) y lleva a la página del turno`, true);
    ok("queda como Reservado", (await page.getByText("Reservado", { exact: true }).count()) > 0);
    ok("la página del turno repite los requisitos", (await page.getByText("Acordate de traer:").count()) > 0);

    await page.getByRole("button", { name: "Confirmo que voy a asistir" }).click();
    await page.getByText("Confirmado", { exact: true }).waitFor();
    ok("el paciente puede confirmar su asistencia", true);
    await page.context().close();
  }

  console.log("\nPaciente: pediatría y rango de edad");
  {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(30_000);
    await openPersonal(page);
    await page.getByRole("button", { name: "OSDE" }).click();
    await page.getByRole("button", { name: "Pediatría" }).click();
    ok("pide la fecha de nacimiento si la especialidad tiene límite de edad", (await page.getByLabel("Fecha de nacimiento del paciente").count()) === 1);
    await page.getByLabel("Fecha de nacimiento del paciente").fill("1990-01-01");
    await page.getByLabel("Fecha de nacimiento del paciente").blur();
    await page.getByText(/no atiende pacientes de \d+ años/).waitFor();
    ok("avisa que un adulto no entra en pediatría", (await page.getByRole("button", { name: /Primero disponible/ }).count()) === 0);
    await page.getByLabel("Fecha de nacimiento del paciente").fill("2018-05-20");
    await page.getByLabel("Fecha de nacimiento del paciente").blur();
    await page.getByRole("button", { name: /Primero disponible/ }).waitFor();
    ok("con la edad correcta ofrece profesionales", true);
    await openPersonal(page);
    await page.getByRole("button", { name: "OSDE" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText("¿Ya te atendiste antes con este profesional?").waitFor();
    ok("con OSDE y el Dr. Pérez pregunta si es primera vez o control (duran distinto)", true);
    await page.context().close();
  }

  console.log("\nPaciente: preocupacional");
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(BASE);
    await page.getByRole("button", { name: /^Preocupacional/ }).click();
    ok("no pide obra social ni especialidad", (await page.getByText("¿Con qué cobertura te atendés?").count()) === 0 && (await page.getByText("¿Qué especialidad necesitás?").count()) === 0);
    const studies = ["Examen preocupacional básico", "Examen con laboratorio", "Examen con estudios complementarios"];
    const shown = await Promise.all(studies.map((name) => page.getByRole("button", { name: new RegExp(name) }).count()));
    ok("ofrece los 3 estudios para elegir", shown.every((n) => n === 1), JSON.stringify(shown));

    await page.getByRole("button", { name: /Examen con laboratorio/ }).click();
    await page.getByText("Elegí día y horario").waitFor();
    await page.getByText("Próximo turno disponible").waitFor();
    ok("al elegir el estudio pasa directo a la agenda con turnos disponibles", true);
    await page.getByText("Próximo turno disponible").click();

    await page.getByText("Para este turno tenés que traer:").waitFor();
    ok("muestra las indicaciones del estudio elegido", (await page.getByText("Venir con 8 horas de ayuno").count()) > 0);
    ok("en preocupacional no pide número de afiliado y sí la empresa", (await page.getByLabel("Número de afiliado").count()) === 0 && (await page.getByLabel("Empresa que solicita el estudio").count()) === 1);

    await fillPatient(page, 20);
    await page.getByLabel("Empresa que solicita el estudio").fill("Constructora E2E SA");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirmar turno" }).click();
    await page.waitForURL("**/turno/**");
    ok("reserva el turno preocupacional", true);
    ok(
      "la página del turno muestra el tipo, el estudio y la empresa",
      (await page.getByText("Preocupacional", { exact: true }).count()) > 0 &&
        (await page.getByText("Examen con laboratorio").count()) > 0 &&
        (await page.getByText("Constructora E2E SA").count()) > 0,
    );
    ok("y repite las indicaciones del estudio", (await page.getByText("Venir con 8 horas de ayuno").count()) > 0);
    await page.context().close();
  }

  // ───────────────────────── Secretaría ─────────────────────────
  console.log("\nSecretaría: agenda");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "secretaria@salus.local", "secretaria1234");

    await page.goto(`${BASE}/agenda?profesional=${perez.id}&fecha=${monday}`);
    await page.getByRole("heading", { name: "Dr. Pérez" }).waitFor();
    ok("ve la agenda del profesional", true);
    ok("muestra las franjas de cada cobertura", (await page.getByText("Franjas por cobertura").count()) === 1);
    ok("muestra los contadores de cupo (PAMI día 1/2: ya hay una reserva online)", (await page.getByText(/día 1\/2/).count()) > 0);

    // El profesional que no tiene asignado no se puede ver.
    await page.goto(`${BASE}/agenda?profesional=${ruiz.id}&fecha=${monday}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    ok("no deja ver la agenda de un profesional no asignado", (await page.getByRole("heading", { name: "Dr. Ruiz" }).count()) === 0);

    // Con la reserva online ya hay 1 PAMI: secretaría da el segundo y el cupo del día queda completo.
    for (const n of [2]) {
      await page.goto(`${BASE}/agenda?profesional=${perez.id}&fecha=${monday}`);
      await page.getByRole("link", { name: "PAMI", exact: true }).first().click();
      await page.getByRole("heading", { name: "Dar turno" }).waitFor();
      await fillPatient(page, n);
      await page.getByRole("button", { name: "Dar turno", exact: true }).click();
      await page.waitForURL("**/agenda?**");
    }
    await page.goto(`${BASE}/agenda?profesional=${perez.id}&fecha=${monday}`);
    ok("los turnos aparecen en la agenda", (await page.getByText(/Navegador1/).count()) > 0 && (await page.getByText(/Navegador2/).count()) > 0);
    ok("el contador de PAMI sube a 2/2 y se marca completo", (await page.getByText(/día 2\/2/).count()) > 0);
    ok("los horarios libres muestran PAMI como cupo completo", (await page.getByText(/PAMI · cupo completo/).count()) > 0);

    // Override
    console.log("\nSecretaría: override con motivo");
    await page.getByRole("link", { name: "Dar turno…" }).first().click();
    await page.getByRole("heading", { name: "Dar turno" }).waitFor();
    await page.getByRole("button", { name: /PAMI/ }).click();
    ok("al elegir PAMI con cupo lleno aparece el panel de override", (await page.getByText("Saltear reglas (override)").count()) === 1);
    await fillPatient(page, 4);
    const submit = page.getByRole("button", { name: "Dar turno con override" });
    ok("no se puede enviar sin el motivo", await submit.isDisabled());
    await page.getByLabel("Motivo (obligatorio)").fill("Paciente derivado por el director");
    await submit.click();
    await page.waitForURL("**/agenda?**");
    ok("el override queda marcado en la agenda", (await page.getByText("Override", { exact: true }).count()) > 0);
    await page.getByText(/Navegador4/).first().click();
    ok("muestra el motivo y la regla salteada", (await page.getByText("Paciente derivado por el director").count()) > 0 && (await page.getByText(/Cupo completo/).count()) > 0);

    // Cancelar con motivo
    console.log("\nSecretaría: cancelar y liberar cupo");
    await page.getByText(/Navegador2/).first().click();
    const details = page.locator("details", { hasText: "Navegador2" }).first();
    await details.getByRole("button", { name: "Cancelar turno…" }).click();
    const cancelButton = details.getByRole("button", { name: "Cancelar el turno" });
    ok("pide el motivo de la cancelación", await cancelButton.isDisabled());
    await details.getByLabel(/Motivo de la cancelación/).fill("El paciente avisó que no puede ir");
    await cancelButton.click();
    await page.getByText("Turnos cancelados (1)").waitFor();
    ok("el turno cancelado pasa a la lista de cancelados", true);
    ok("al cancelar se libera el cupo (el override sigue contando: 2/2, no 3/2)", (await page.getByText(/día 3\/2/).count()) === 0 && (await page.getByText(/día 2\/2/).count()) > 0);

    // Vistas restantes
    await page.goto(`${BASE}/agenda/semana?profesional=${perez.id}&fecha=${monday}`);
    await page.getByRole("heading", { name: "Dr. Pérez" }).waitFor();
    ok("la vista semanal muestra los turnos de la semana", (await page.getByText(/Navegador4/).count()) > 0);
    await page.goto(`${BASE}/agenda/lista-espera`);
    ok("la lista de espera carga", (await page.getByRole("heading", { name: "Lista de espera" }).count()) === 1);
    await page.context().close();
  }

  console.log("\nSecretaría: descargar la agenda del día");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "secretaria@salus.local", "secretaria1234");
    await page.goto(`${BASE}/agenda?profesional=${perez.id}&fecha=${monday}`);
    await page.getByRole("heading", { name: "Dr. Pérez" }).waitFor();

    const doctor = await downloadPdf(page, "Descargar agenda del día (PDF)");
    ok("descarga la agenda del médico en PDF", doctor.valid && doctor.filename === `agenda-${monday}-dr-perez.pdf`, JSON.stringify(doctor));
    const occupational = await downloadPdf(page, "Descargar preocupacionales del día (PDF)");
    ok("descarga la agenda de preocupacionales en PDF", occupational.valid && occupational.filename === `preocupacionales-${monday}.pdf`, JSON.stringify(occupational));
    ok("cada descarga queda en el registro de actividad", (await db.auditLog.count({ where: { action: "AGENDA_DOWNLOADED", createdAt: { gte: startedAt } } })) >= 2);

    const request = page.context().request;
    ok("no deja descargar la agenda de un profesional no asignado", (await request.get(`${BASE}/agenda/descargar?profesional=${ruiz.id}&fecha=${monday}`)).status() === 403);
    ok("rechaza una fecha inválida", (await request.get(`${BASE}/agenda/descargar?profesional=${perez.id}&fecha=2026-02-31`)).status() === 400);
    const anonymous = await (await browser.newContext()).request.get(`${BASE}/agenda/descargar?profesional=${perez.id}&fecha=${monday}`);
    ok("sin iniciar sesión no entrega nada", anonymous.status() === 401);
    await page.context().close();
  }

  console.log("\nProfesional");
  {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "perez@salus.local", "perez1234");
    await page.goto(`${BASE}/agenda?profesional=${ruiz.id}&fecha=${monday}`);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    ok("ve solo su propia agenda", (await page.getByRole("heading", { name: "Dr. Pérez" }).count()) === 1);
    ok("no tiene acceso a la configuración", (await page.getByRole("link", { name: "Configuración" }).count()) === 0);
    await page.context().close();
  }

  console.log("\nPaciente: cancelar desde su link");
  {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(appointmentUrl);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Cancelar turno" }).click();
    await page.getByText("Este turno fue cancelado.").waitFor();
    ok("el paciente cancela su turno con el link", true);
    await page.context().close();
  }

  // ───────────────────────── Administración ─────────────────────────
  console.log("\nAdministración: reglas, horarios y catálogos");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "admin@salus.local", "admin1234");

    await page.goto(`${BASE}/configuracion`);
    ok("la administración ve el menú de configuración completo", (await page.getByText("Registro de actividad").count()) > 0 && (await page.getByText("Usuarios", { exact: true }).count()) > 0);

    // Cambiar el cupo diario de PAMI desde la pantalla (2 → 3) y volver a dejarlo en 2.
    await page.goto(`${BASE}/configuracion/reglas/${pamiRule.id}`);
    await page.getByRole("heading", { name: "Editar regla" }).waitFor();
    await page.getByLabel("Máximo").first().fill("3");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.getByText("Guardado ✓").waitFor();
    ok("editar el cupo diario de PAMI desde la pantalla lo guarda (2 → 3)", (await db.ruleQuota.findFirstOrThrow({ where: { ruleId: pamiRule.id, period: "DAY" } })).max === 3);
    ok("el cambio queda en el registro de actividad", (await db.auditLog.count({ where: { action: "RULE_UPDATED", entityId: pamiRule.id } })) > 0);
    await page.getByLabel("Máximo").first().fill("2");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.getByText("Guardado ✓").waitFor();
    ok("se puede volver a dejar en 2", (await db.ruleQuota.findFirstOrThrow({ where: { ruleId: pamiRule.id, period: "DAY" } })).max === 2);

    // Nueva cobertura y nueva regla desde las pantallas.
    await page.goto(`${BASE}/configuracion/catalogos`);
    await page.locator("#new-cn").fill("Obra Social E2E");
    await page.locator("form", { has: page.locator("#new-cn") }).getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    const coverage = await db.coverage.findFirstOrThrow({ where: { name: "Obra Social E2E" } });
    ok("se puede agregar una cobertura desde la pantalla", true);

    await page.goto(`${BASE}/configuracion/reglas/nueva?profesional=${perez.id}&cobertura=${coverage.id}`);
    await page.getByRole("button", { name: "Crear regla" }).click();
    await page.getByText(/al menos una franja/).waitFor();
    ok("no deja crear una regla sin franjas horarias", true);
    await page.getByRole("button", { name: "+ Atender este día" }).first().click();
    await page.getByRole("button", { name: "Crear regla" }).click();
    await page.waitForURL(/\/configuracion\/reglas\/(?!nueva)[a-z0-9]+$/);
    ok("crea la regla y pasa a su pantalla de edición", (await page.getByRole("heading", { name: "Editar regla" }).count()) === 1);
    const e2eRule = await db.coverageRule.findFirstOrThrow({ where: { professionalId: perez.id, coverageId: coverage.id } });
    ok("la regla queda guardada en la base", !!e2eRule);

    await openPersonal(page);
    await page.getByRole("button", { name: "Obra Social E2E" }).click();
    await page.getByRole("button", { name: "Traumatología" }).waitFor();
    ok("la nueva cobertura aparece enseguida en el turnero del paciente", true);

    await page.goto(`${BASE}/configuracion/reglas/${e2eRule.id}`);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Eliminar regla" }).click();
    await page.waitForURL("**/configuracion/reglas");
    ok("se puede eliminar una regla", (await db.coverageRule.count({ where: { id: e2eRule.id } })) === 0);

    // Horarios: agregar y quitar un bloque del sábado.
    await page.goto(`${BASE}/configuracion/horarios?profesional=${perez.id}`);
    const saturday = page.locator("li", { hasText: "Sábado" }).first();
    await saturday.getByRole("button", { name: "+ Agregar horario" }).click();
    await page.getByRole("button", { name: "Guardar horarios" }).click();
    await page.getByText("Guardado ✓").waitFor();
    ok("agregar un horario de sábado lo guarda", (await db.agendaBlock.count({ where: { professionalId: perez.id, weekday: 6 } })) === 1);
    await saturday.getByRole("button", { name: /Quitar horario del Sábado/ }).click();
    await page.getByRole("button", { name: "Guardar horarios" }).click();
    await page.getByText("Guardado ✓").waitFor();
    ok("y se puede volver a quitar", (await db.agendaBlock.count({ where: { professionalId: perez.id, weekday: 6 } })) === 0);

    // Registro de actividad
    await page.goto(`${BASE}/configuracion/auditoria`);
    ok("el registro de actividad muestra los overrides", (await page.getByText("Turno con override").count()) > 0);
    await page.context().close();
  }

  console.log("\nAdministración: preocupacional");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "admin@salus.local", "admin1234");

    await page.goto(`${BASE}/configuracion/catalogos`);
    ok("la cobertura Preocupacional no se puede renombrar", (await page.locator('input[name="name"][value="Preocupacional"]').getAttribute("readonly")) !== null);

    await page.goto(`${BASE}/configuracion/estudios`);
    await page.getByRole("heading", { name: "Estudios preocupacionales" }).waitFor();
    ok("lista los estudios cargados", (await page.getByText("Examen con laboratorio").count()) === 0 && (await page.locator('input[value="Examen con laboratorio"]').count()) === 1);
    await page.locator("#new-stn").fill("Estudio E2E");
    await page.locator("#std-new").fill("Descripción de prueba");
    await page.locator("#sti-new").fill("Traer el DNI\nTraer anteojos");
    await page.locator("form", { has: page.locator("#new-stn") }).getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    const created = await db.occupationalStudy.findFirstOrThrow({ where: { name: "Estudio E2E" } });
    ok("se puede agregar un estudio desde la pantalla", created.instructions === "Traer el DNI\nTraer anteojos" && created.active);
    await page.goto(BASE);
    await page.getByRole("button", { name: /^Preocupacional/ }).click();
    ok("el estudio nuevo aparece enseguida en el turnero", (await page.getByRole("button", { name: /Estudio E2E/ }).count()) === 1);
    await db.occupationalStudy.update({ where: { id: created.id }, data: { active: false } });
    await page.goto(BASE);
    await page.getByRole("button", { name: /^Preocupacional/ }).click();
    ok("un estudio desactivado deja de ofrecerse", (await page.getByRole("button", { name: /Estudio E2E/ }).count()) === 0);

    // Secretaría/administración da un turno preocupacional desde la agenda de la profesional.
    await page.goto(`${BASE}/agenda?profesional=${medina.id}&fecha=${tuesday}`);
    await page.getByRole("heading", { name: "Dra. Medina" }).waitFor();
    await page.getByRole("link", { name: "Preocupacional", exact: true }).first().click();
    await page.getByRole("heading", { name: "Dar turno" }).waitFor();
    ok("al elegir Preocupacional pide estudio y empresa, y no el número de afiliado", (await page.locator("#studyId").count()) === 1 && (await page.locator("#company").count()) === 1 && (await page.getByLabel("Número de afiliado").count()) === 0);
    const submit = page.getByRole("button", { name: "Dar turno", exact: true });
    ok("no se puede enviar sin elegir el estudio", await submit.isDisabled());
    await page.locator("#studyId").selectOption({ label: "Examen preocupacional básico" });
    await page.locator("#company").fill("Transportes E2E SRL");
    await fillPatient(page, 21);
    await submit.click();
    await page.waitForURL("**/agenda?**");
    const booked = await db.appointment.findFirstOrThrow({ where: { patient: { dni: "91000021" } }, include: { study: true } });
    ok("el turno queda con el estudio y la empresa", booked.study?.name === "Examen preocupacional básico" && booked.company === "Transportes E2E SRL" && booked.source === "STAFF");
    await page.getByText(/Navegador21/).first().click();
    ok("la agenda muestra el estudio y la empresa del turno", (await page.getByText("Transportes E2E SRL").count()) > 0 && (await page.getByText("Examen preocupacional básico").count()) > 0);

    const occupational = await downloadPdf(page, "Descargar preocupacionales del día (PDF)");
    ok("la agenda de preocupacionales del día se descarga en PDF", occupational.valid && occupational.filename === `preocupacionales-${tuesday}.pdf`, JSON.stringify(occupational));
    await page.context().close();
  }

  console.log("\nAdministración: usuarios");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "admin@salus.local", "admin1234");
    await page.goto(`${BASE}/configuracion/usuarios`);
    await page.locator("#nu-name").fill("Secretaría E2E");
    await page.locator("#nu-email").fill("e2e.secretaria");
    await page.locator("#nu-pass").fill("clave-segura-123");
    const createForm = page.locator("form", { has: page.locator("#nu-name") });
    await createForm.getByLabel("Dra. Gómez").check();
    await createForm.getByRole("button", { name: "Crear usuario" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    ok("la administración crea un usuario de secretaría con acceso a una sola agenda", (await db.user.count({ where: { email: "e2e.secretaria" } })) === 1);
    await page.context().close();

    const secretary = await (await browser.newContext()).newPage();
    secretary.setDefaultTimeout(30_000);
    await login(secretary, "e2e.secretaria", "clave-segura-123");
    await secretary.getByRole("heading", { level: 1 }).first().waitFor();
    ok("el nuevo usuario de secretaría entra y ve solo la agenda que se le asignó", (await secretary.getByRole("heading", { name: "Dra. Gómez" }).count()) === 1 && (await secretary.getByText("Dr. Pérez").count()) === 0);
    await secretary.goto(`${BASE}/configuracion/catalogos`);
    await secretary.waitForURL("**/agenda**");
    ok("y no puede entrar a las pantallas de administración", true);
    await secretary.goto(`${BASE}/configuracion/excepciones`);
    await secretary.getByRole("heading", { name: "Feriados, licencias y bloqueos" }).waitFor();
    ok("no puede cargar feriados de todo el centro", (await secretary.locator("#kind option", { hasText: "Feriado" }).count()) === 0 && (await secretary.locator("#professionalId option", { hasText: "Todo el centro" }).count()) === 0);
    await secretary.context().close();
  }

  console.log("\nSecretaría: licencias");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "secretaria@salus.local", "secretaria1234");
    const leaveDay = addDaysToDate(monday, 14);
    await page.goto(`${BASE}/configuracion/excepciones`);
    await page.locator("#professionalId").selectOption({ label: "Dr. Pérez" });
    await page.locator("#dateFrom").fill(leaveDay);
    await page.locator("#note").fill("Congreso de prueba");
    await page.getByRole("button", { name: "Bloquear" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    ok("carga una licencia del Dr. Pérez", (await db.scheduleException.count({ where: { professionalId: perez.id, dateFrom: leaveDay } })) === 1);
    await page.goto(`${BASE}/agenda?profesional=${perez.id}&fecha=${leaveDay}`);
    await page.getByText("Sin atención este día").waitFor();
    ok("la agenda de ese día muestra que no hay atención", true);
    await page.goto(`${BASE}/configuracion/excepciones`);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("li", { hasText: "Congreso de prueba" }).getByRole("button", { name: "Quitar" }).click();
    await page.getByText("Congreso de prueba").waitFor({ state: "detached" });
    ok("se puede quitar la licencia", (await db.scheduleException.count({ where: { professionalId: perez.id, dateFrom: leaveDay } })) === 0);
    await page.context().close();
  }

  // ───────────────────────── Sin turnos: alternativa particular y lista de espera ─────────────────────────
  console.log("\nPaciente: sin turnos con su cobertura");
  {
    // Se completan los cupos de PAMI del Dr. Pérez en todo el plazo de reserva.
    const filler = await db.patient.create({ data: { dni: "91009001", firstName: "Cupo", lastName: "Completo", birthDate: "1950-01-01", phone: "1122334455" } });
    const pami = await db.coverage.findFirstOrThrow({ where: { name: "PAMI" } });
    const toInstant = (date: string, minutes: number) => zonedTimeToUtc(date, minutes, settings.timezone);
    for (let date = today; date <= addDaysToDate(today, settings.bookingHorizonDays); date = addDaysToDate(date, 1)) {
      if (![1, 3].includes(weekdayOf(date))) continue;
      for (const start of [9 * 60 + 40, 10 * 60]) {
        await db.appointment.create({
          data: { professionalId: perez.id, patientId: filler.id, coverageId: pami.id, localDate: date, startsAt: toInstant(date, start), endsAt: toInstant(date, start + 20), status: "CONFIRMED", isOverride: true, overrideReason: "relleno de prueba" },
        });
      }
    }

    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    await openPersonal(page);
    await page.getByRole("button", { name: "PAMI" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText(/No hay turnos disponibles con PAMI/).waitFor();
    ok("sin turnos con PAMI lo avisa", true);
    ok("ofrece pasar a atención particular", (await page.getByText("Ver turnos de atención particular").count()) === 1);
    ok("ofrece la lista de espera", (await page.getByText("Anotarme en la lista de espera").count()) === 1);

    await page.getByText("Ver turnos de atención particular").click();
    await page.getByText("Próximo turno disponible").waitFor();
    ok("al aceptar muestra los turnos particulares", true);

    await openPersonal(page);
    await page.getByRole("button", { name: "PAMI" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText("Anotarme en la lista de espera").click();
    await fillPatient(page, 5);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Anotarme en la lista de espera" }).last().click();
    await page.getByText(/Te anotamos/).waitFor();
    ok("se anota en la lista de espera", (await db.waitlistEntry.count({ where: { patient: { dni: "91000005" }, status: "WAITING" } })) === 1);
    await page.context().close();

    const staff = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    staff.setDefaultTimeout(30_000);
    await login(staff, "secretaria@salus.local", "secretaria1234");
    await staff.goto(`${BASE}/agenda/lista-espera`);
    await staff.getByText(/Navegador5/).waitFor();
    ok("secretaría ve al paciente en la lista de espera", true);
    await staff.locator("li", { hasText: "Navegador5" }).getByRole("button", { name: "Quitar de la lista" }).click();
    await staff.getByText(/Navegador5/).waitFor({ state: "detached" });
    ok("y puede sacarlo de la lista", true);
    await staff.context().close();
  }

  console.log("\nSeguridad: intentos de login");
  {
    // IP simulada distinta en cada corrida, para no dejar bloqueadas las pruebas que siguen.
    const fakeIp = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
    const page = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp } })).newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Email").fill("nadie@example.com");
    // Cada intento espera a que el formulario termine de procesar (el botón vuelve a decir «Ingresar»).
    const attempt = async (password: string) => {
      await page.getByLabel("Contraseña").fill(password);
      await page.getByRole("button", { name: "Ingresar" }).click();
      await page.getByRole("button", { name: "Ingresando…" }).waitFor({ state: "detached" });
      await page.locator("form p[role=alert]").waitFor();
    };
    for (let i = 1; i <= 6; i += 1) await attempt(`incorrecta-${i}`);
    ok("las 6 primeras contraseñas incorrectas solo avisan que son incorrectas", (await page.getByText("Email o contraseña incorrectos.").count()) === 1);
    ok("tras un error el formulario conserva el email escrito", (await page.getByLabel("Email").inputValue()) === "nadie@example.com");
    await attempt("incorrecta-7");
    const blocked = await page.getByText(/Demasiados intentos fallidos/).waitFor({ timeout: 10_000 }).then(() => true, () => false);
    const registered = await db.auditLog.count({ where: { action: "LOGIN_FAILED", details: { contains: "nadie@example.com" }, createdAt: { gte: startedAt } } });
    ok("después de 6 fallos seguidos se frena el intento (aunque sea otra contraseña)", blocked, `fallos registrados en la base: ${registered}`);
    await page.context().close();
  }
} finally {
  await browser.close();
  await db.rateLimitHit.deleteMany();
  const ids = (await db.patient.findMany({ where: { dni: { startsWith: "9100" } }, select: { id: true } })).map((p) => p.id);
  await db.waitlistEntry.deleteMany({ where: { patientId: { in: ids } } });
  await db.notificationLog.deleteMany({ where: { OR: [{ appointment: { patientId: { in: ids } } }, { waitlistEntry: { patientId: { in: ids } } }] } });
  await db.coverageRule.deleteMany({ where: { coverage: { name: "Obra Social E2E" } } });
  await db.coverage.deleteMany({ where: { name: "Obra Social E2E" } });
  await db.userProfessionalAccess.deleteMany({ where: { user: { email: "e2e.secretaria" } } });
  await db.user.deleteMany({ where: { email: "e2e.secretaria" } });
  await db.appointment.deleteMany({ where: { patientId: { in: ids } } });
  await db.occupationalStudy.deleteMany({ where: { name: "Estudio E2E" } });
  await db.patient.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entity: { in: ["Appointment", "Patient", "WaitlistEntry", "ScheduleException", "CoverageRule", "Coverage", "Professional", "OccupationalStudy", "Agenda"] } }, { action: { in: ["USER_CREATED", "LOGIN", "LOGIN_FAILED"] } }] } });
  await db.$disconnect();
}

console.log(failures === 0 ? "\nTodo en orden ✔" : `\n${failures} verificación(es) fallaron ✘`);
process.exit(failures === 0 ? 0 : 1);

/** Mismo texto que muestra el botón de cada día en el turnero (ej. "Lun, 19 oct"). */
function dayLabel(date: string) {
  const text = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
