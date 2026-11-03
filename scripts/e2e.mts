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


const perez = await db.professional.findFirstOrThrow({ where: { name: "Dr. Pérez" } });
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

/** Entra al turnero (con la sesión de paciente que ya tenga la página). */
async function openPersonal(page: Page) {
  await page.goto(BASE);
}

const dniOf = (n: number) => `9100${String(n).padStart(4, "0")}`;

/** Completa el formulario de registro (sin enviarlo). */
async function fillRegister(page: Page, n: number, extra: { birthDate?: string; dni?: string } = {}) {
  await page.goto(`${BASE}/registro`);
  await page.getByLabel("Nombre", { exact: true }).fill("Prueba");
  await page.getByLabel("Apellido").fill(`Navegador${n}`);
  await page.getByLabel("DNI", { exact: true }).fill(extra.dni ?? dniOf(n));
  await page.getByLabel("Fecha de nacimiento").fill(extra.birthDate ?? "1958-04-12");
  await page.getByLabel("Email").fill(`navegador${n}@example.com`);
  await page.getByLabel(/Teléfono/).fill("11 2345 6789");
}

/** Crea una cuenta de paciente desde la pantalla de registro y espera a quedar adentro. */
async function registerPatient(page: Page, n: number, extra: { birthDate?: string } = {}) {
  await fillRegister(page, n, extra);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.waitForURL(`${BASE}/`);
}

/** Ingresa al turnero solo con el DNI. */
async function loginPatient(page: Page, n: number) {
  await page.goto(`${BASE}/ingresar`);
  await page.getByLabel("DNI", { exact: true }).fill(dniOf(n));
  await page.getByRole("button", { name: "Ingresar" }).click();
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
  console.log("\nPaciente: cuenta y reserva online");
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); // celular
    page.setDefaultTimeout(30_000);
    await page.goto(BASE);
    ok("sin ingresar la entrada pide ingresar y no muestra las coberturas", (await page.getByText("Para sacar un turno online ingresá").count()) === 1 && (await page.getByRole("button", { name: "PAMI" }).count()) === 0);
    await page.getByRole("link", { name: "Creá tu cuenta" }).click();
    await page.waitForURL("**/registro");

    await fillRegister(page, 1);
    ok("el registro ya no pide contraseña", (await page.getByLabel(/contraseña/i).count()) === 0);
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.getByText("Tenés que aceptar").waitFor();
    ok("exige aceptar el uso de los datos", (await db.patientAccount.count({ where: { dni: dniOf(1) } })) === 0);
    ok("si hay un error, no borra lo que la persona ya escribió", (await page.getByLabel("Apellido").inputValue()) === "Navegador1");

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.waitForURL(`${BASE}/`);
    const account = await db.patientAccount.findUniqueOrThrow({ where: { dni: dniOf(1) } });
    ok("crea la cuenta y deja al paciente adentro, sin verificar", !account.verifiedAt && (await page.getByRole("link", { name: "Prueba" }).count()) > 0);

    await page.getByText("¿Con qué cobertura se atiende?").waitFor();
    ok("la entrada pide la cobertura, sin preguntar el tipo de turno", (await page.getByText("¿Qué tipo de turno necesitás?").count()) === 0);
    ok("la página pública muestra las coberturas", (await page.getByRole("button", { name: "PAMI" }).count()) > 0);
    ok("no hay camino preocupacional", (await page.getByText("Preocupacional").count()) === 0);
    ok("con una sola persona no pregunta para quién es el turno", (await page.getByText("¿Para quién es el turno?").count()) === 0);

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
    ok("ya no pide los datos personales: salen de la cuenta", (await page.getByLabel("DNI").count()) === 0 && (await page.getByText("Paciente:").count()) > 0);

    await page.getByRole("button", { name: "Confirmar turno" }).click();
    await page.waitForURL("**/turno/**");
    appointmentUrl = page.url();
    ok(`reserva el turno (${slotText}) y lleva a la página del turno`, true);
    ok("queda como Reservado", (await page.getByText("Reservado", { exact: true }).count()) > 0);
    ok("la página del turno repite los requisitos", (await page.getByText("Acordate de traer:").count()) > 0);
    ok("el turno queda asociado a la cuenta", (await db.appointment.count({ where: { accountId: account.id } })) === 1);

    await page.getByRole("button", { name: "Confirmo que voy a asistir" }).click();
    await page.getByText("Confirmado", { exact: true }).waitFor();
    ok("el paciente puede confirmar su asistencia", true);

    await page.goto(`${BASE}/cuenta`);
    await page.getByRole("heading", { name: "Mis próximos turnos" }).waitFor();
    ok("«Mi cuenta» lista el turno", (await page.getByText(/Dr\. Pérez/).count()) > 0);
    await page.getByRole("button", { name: "Salir" }).click();
    await page.getByText("Para sacar un turno online ingresá").waitFor();
    ok("al salir vuelve a pedir ingresar", (await page.getByRole("button", { name: "PAMI" }).count()) === 0);
    await page.goto(`${BASE}/cuenta`);
    await page.waitForURL("**/ingresar");
    ok("sin sesión «Mi cuenta» manda a ingresar", true);

    await page.goto(`${BASE}/ingresar`);
    await page.getByLabel("DNI", { exact: true }).fill("91009998");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.getByText("No encontramos una cuenta con ese DNI.").waitFor();
    ok("un DNI sin cuenta no entra y ofrece crearla", (await page.getByRole("link", { name: "Crear mi cuenta con este DNI" }).count()) === 1);
    await page.getByRole("link", { name: "Crear mi cuenta con este DNI" }).click();
    await page.waitForURL("**/registro?dni=91009998");
    ok("y la pantalla de registro ya trae el DNI escrito", (await page.getByLabel("DNI", { exact: true }).inputValue()) === "91009998");

    await loginPatient(page, 1);
    await page.waitForURL(`${BASE}/`);
    ok("con su DNI vuelve a entrar", (await page.getByText("¿Con qué cobertura se atiende?").count()) === 1);
    await page.context().close();
  }

  console.log("\nPaciente: familiares, pediatría y rango de edad");
  {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(30_000);
    await loginPatient(page, 1);
    await page.waitForURL(`${BASE}/`);

    await page.goto(`${BASE}/cuenta`);
    const familyForm = page.locator("form", { has: page.getByRole("button", { name: "Agregar persona" }) });
    await familyForm.getByLabel("Nombre").fill("Hijo");
    await familyForm.getByLabel("Apellido").fill("Navegador1");
    await familyForm.getByLabel("DNI").fill("91000010");
    await familyForm.getByLabel("Fecha de nacimiento").fill("2018-05-20");
    await familyForm.getByRole("button", { name: "Agregar persona" }).click();
    await page.getByText("Listo, ya podés sacarle turnos").waitFor();
    ok("agrega a un hijo a la cuenta", (await db.accountPatient.count({ where: { account: { dni: dniOf(1) } } })) === 1);

    await familyForm.getByLabel("Nombre").fill("Otro");
    await familyForm.getByLabel("Apellido").fill("Menor");
    await familyForm.getByLabel("DNI").fill("91000010");
    await familyForm.getByLabel("Fecha de nacimiento").fill("2010-01-01");
    await familyForm.getByRole("button", { name: "Agregar persona" }).click();
    await page.getByText(/no coinciden con los registrados/).first().waitFor();
    ok("no deja agregar a alguien con un DNI ya registrado y otra fecha de nacimiento", (await db.accountPatient.count({ where: { account: { dni: dniOf(1) } } })) === 1);

    await openPersonal(page);
    await page.getByText("¿Para quién es el turno?").waitFor();
    ok("con familiares pregunta para quién es el turno", (await page.getByRole("button", { name: /Hijo Navegador1/ }).count()) === 1);

    // La titular (nacida en 1958) no entra en pediatría.
    await page.getByRole("button", { name: "OSDE" }).click();
    await page.getByRole("button", { name: "Pediatría" }).click();
    await page.getByText(/no atiende esa edad/).waitFor();
    ok("avisa que un adulto no entra en pediatría", (await page.getByRole("button", { name: /Primero disponible/ }).count()) === 0);

    // Con su hijo sí.
    await page.getByRole("button", { name: /Hijo Navegador1/ }).click();
    await page.getByRole("button", { name: "OSDE" }).click();
    await page.getByRole("button", { name: "Pediatría" }).click();
    await page.getByRole("button", { name: /Primero disponible/ }).waitFor();
    ok("para el hijo ofrece profesionales de pediatría", true);

    await page.getByRole("button", { name: /Prueba Navegador1/ }).click();
    await page.getByRole("button", { name: "OSDE" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText("¿Ya te atendiste antes con este profesional?").waitFor();
    ok("con OSDE y el Dr. Pérez pregunta si es primera vez o control (duran distinto)", true);
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
    ok("ya no hay descarga de preocupacionales", (await page.getByRole("link", { name: /preocupacionales/i }).count()) === 0);
    ok("la descarga queda en el registro de actividad", (await db.auditLog.count({ where: { action: "AGENDA_DOWNLOADED", createdAt: { gte: startedAt } } })) >= 1);

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

    const patientPage = await (await browser.newContext()).newPage();
    patientPage.setDefaultTimeout(30_000);
    await loginPatient(patientPage, 1);
    await patientPage.waitForURL(`${BASE}/`);
    await patientPage.getByRole("button", { name: "Obra Social E2E" }).click();
    await patientPage.getByRole("button", { name: "Traumatología" }).waitFor();
    ok("la nueva cobertura aparece enseguida en el turnero del paciente", true);
    await patientPage.context().close();

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

  console.log("\nAdministración: profesionales con varias especialidades");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "admin@salus.local", "admin1234");
    await page.goto(`${BASE}/configuracion/profesionales`);
    const createForm = page.locator("form", { has: page.locator("#pn-new") });

    await page.locator("#pn-new").fill("Dr. E2E Sin Especialidad");
    await createForm.getByRole("button", { name: "Agregar" }).click();
    await page.getByText(/al menos una especialidad/).first().waitFor();
    ok("no deja crear un profesional sin especialidad", (await db.professional.count({ where: { name: "Dr. E2E Sin Especialidad" } })) === 0);

    await page.locator("#pn-new").fill("Dr. E2E Doble");
    await page.locator("#pl-new").fill("99999");
    await createForm.getByLabel("Traumatología", { exact: true }).check();
    await createForm.getByLabel("Neurología", { exact: true }).check();
    await createForm.getByRole("button", { name: "Agregar" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    const created = await db.professional.findFirstOrThrow({ where: { name: "Dr. E2E Doble" }, include: { specialties: true } });
    ok("crea un profesional con dos especialidades", created.specialties.map((sp) => sp.name).sort().join(",") === "Neurología,Traumatología");

    await page.goto(`${BASE}/configuracion/profesionales`);
    const editForm = page.locator("form", { has: page.locator(`input[name="id"][value="${created.id}"]`) });
    ok("al volver a abrirlo muestra las dos tildadas", (await editForm.getByLabel("Traumatología", { exact: true }).isChecked()) && (await editForm.getByLabel("Neurología", { exact: true }).isChecked()) && !(await editForm.getByLabel("Pediatría", { exact: true }).isChecked()));
    await editForm.getByLabel("Neurología", { exact: true }).uncheck();
    await editForm.getByLabel("Pediatría", { exact: true }).check();
    await editForm.getByRole("button", { name: "Guardar" }).click();
    await page.getByText("Guardado ✓").first().waitFor();
    const edited = await db.professional.findUniqueOrThrow({ where: { id: created.id }, include: { specialties: true } });
    ok("se le pueden cambiar las especialidades", edited.specialties.map((sp) => sp.name).sort().join(",") === "Pediatría,Traumatología");

    await page.goto(`${BASE}/agenda`);
    ok("la agenda lo muestra con todas sus especialidades", (await page.getByRole("link", { name: /Dr\. E2E Doble/ }).first().innerText()).includes("Pediatría / Traumatología"));
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

  console.log("\nSecretaría: cuentas de pacientes");
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
    page.setDefaultTimeout(30_000);
    await login(page, "secretaria@salus.local", "secretaria1234");
    await page.goto(`${BASE}/configuracion/cuentas`);
    const row = page.locator("li", { hasText: `DNI ${dniOf(1)}` });
    await row.waitFor();
    ok("lista la cuenta recién creada, sin verificar", (await row.getByText("Sin verificar").count()) === 1);

    await row.getByRole("button", { name: "Verificar (vi el DNI)" }).click();
    await row.getByText("Guardado ✓").waitFor();
    const verified = await db.patientAccount.findUniqueOrThrow({ where: { dni: dniOf(1) } });
    ok("la secretaría verifica la cuenta y queda quién lo hizo", !!verified.verifiedAt && !!verified.verifiedById);
    ok("la verificación queda en el registro de actividad", (await db.auditLog.count({ where: { action: "ACCOUNT_VERIFIED", entityId: verified.id } })) === 1);

    const patient = await (await browser.newContext()).newPage();
    patient.setDefaultTimeout(30_000);
    await loginPatient(patient, 1);
    await patient.waitForURL(`${BASE}/`);
    ok("el paciente entra solo con su DNI", true);
    await patient.goto(`${BASE}/cuenta`);
    ok("«Mi cuenta» ya no tiene contraseña que cambiar", (await patient.getByText(/contraseña/i).count()) === 0);

    page.once("dialog", (dialog) => void dialog.accept());
    await row.getByRole("button", { name: "Bloquear" }).click();
    await row.getByText("Bloqueada").waitFor();
    ok("la secretaría bloquea la cuenta", (await db.patientAccount.findUniqueOrThrow({ where: { dni: dniOf(1) } })).blocked);
    await patient.goto(`${BASE}/`);
    await patient.getByText("Para sacar un turno online ingresá").waitFor();
    ok("una cuenta bloqueada pierde la sesión que tenía", true);
    await loginPatient(patient, 1);
    await patient.getByText(/cuenta está bloqueada/).waitFor();
    ok("y no puede volver a ingresar", true);

    await row.getByRole("button", { name: "Desbloquear" }).click();
    await row.getByText("Bloqueada").waitFor({ state: "detached" });
    await patient.goto(`${BASE}/`);
    await patient.getByText("¿Con qué cobertura se atiende?").waitFor();
    ok("al desbloquearla vuelve a tener acceso", true);
    await patient.context().close();

    await page.goto(`${BASE}/configuracion/cuentas?q=Navegador1&estado=sin-verificar`);
    await page.getByText("No hay cuentas que coincidan.").waitFor();
    ok("el filtro «sin verificar» no muestra las ya verificadas", true);
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

    // Un DNI que ya tiene ficha (el paciente de relleno) no se puede reclamar con otra fecha de nacimiento.
    await fillRegister(page, 8, { dni: "91009001", birthDate: "1990-01-01" });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.getByText(/no coinciden con los registrados/).first().waitFor();
    ok("no deja crear una cuenta con el DNI de otra persona (fecha de nacimiento distinta)", (await db.patientAccount.count({ where: { dni: "91009001" } })) === 0);

    await registerPatient(page, 5);
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

  console.log("\nPaciente: tope de turnos de una cuenta sin verificar");
  {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    await registerPatient(page, 6);
    const account = await db.patientAccount.findUniqueOrThrow({ where: { dni: dniOf(6) }, include: { patient: true } });
    const cover = await db.coverage.findFirstOrThrow({ where: { name: "Particular" } });
    // Dos turnos pendientes lejanos (fuera de la grilla, solo para ocupar el tope).
    for (const n of [1, 2]) {
      const date = addDaysToDate(today, 40 + n);
      await db.appointment.create({
        data: { professionalId: ruiz.id, patientId: account.patientId, coverageId: cover.id, accountId: account.id, localDate: date, startsAt: zonedTimeToUtc(date, 3 * 60, settings.timezone), endsAt: zonedTimeToUtc(date, 3 * 60 + 20, settings.timezone), status: "RESERVED" },
      });
    }
    await page.goto(`${BASE}/cuenta`);
    ok("«Mi cuenta» explica el tope mientras no esté verificada", (await page.getByText(/podés tener 2 turnos pendientes a la vez/).count()) === 1);

    await openPersonal(page);
    await page.getByRole("button", { name: "Particular" }).click();
    await page.getByRole("button", { name: "Traumatología" }).click();
    await page.getByRole("button", { name: /Dr\. Pérez/ }).click();
    await page.getByRole("button", { name: "Buscar turno" }).click();
    await page.getByText("Próximo turno disponible").waitFor();
    await page.getByRole("button", { name: dayLabel(monday), exact: true }).click();
    await page.locator("div.grid button[aria-pressed]").filter({ hasText: /\d{2}:\d{2} hs/ }).first().click();
    await page.getByRole("button", { name: "Confirmar turno" }).click();
    await page.getByText(/Ya tenés 2 turnos pendientes/).waitFor();
    ok("una cuenta sin verificar con 2 turnos pendientes no puede sacar un tercero", (await db.appointment.count({ where: { accountId: account.id } })) === 2);
    await page.context().close();
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

    // Ingreso de pacientes: solo se cuentan los DNI sin cuenta (lo que haría quien busca cuentas ajenas).
    const patientPage = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `203.0.114.${1 + Math.floor(Math.random() * 250)}` } })).newPage();
    patientPage.setDefaultTimeout(30_000);
    await patientPage.goto(`${BASE}/ingresar`);
    const patientAttempt = async (dni: string) => {
      await patientPage.getByLabel("DNI", { exact: true }).fill(dni);
      await patientPage.getByRole("button", { name: "Ingresar" }).click();
      await patientPage.getByRole("button", { name: "Ingresando…" }).waitFor({ state: "detached" });
      await patientPage.locator("form p[role=alert]").waitFor();
    };
    for (let i = 1; i <= 10; i += 1) await patientAttempt(`9100999${i % 10}`);
    ok("probar DNI sin cuenta solo avisa que no hay cuenta", (await patientPage.getByText("No encontramos una cuenta con ese DNI.").count()) === 1);
    await patientAttempt("91009991");
    ok("después de 10 DNI sin cuenta seguidos se frena el ingreso", await patientPage.getByText(/Demasiados intentos/).waitFor({ timeout: 10_000 }).then(() => true, () => false));
    await patientPage.context().close();
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
  await db.professional.deleteMany({ where: { name: { startsWith: "Dr. E2E " } } });
  await db.user.deleteMany({ where: { email: "e2e.secretaria" } });
  await db.appointment.deleteMany({ where: { patientId: { in: ids } } });
  await db.patientAccount.deleteMany({ where: { dni: { startsWith: "9100" } } });
  await db.patient.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ entity: { in: ["Appointment", "Patient", "PatientAccount", "WaitlistEntry", "ScheduleException", "CoverageRule", "Coverage", "Professional", "Agenda"] } }, { action: { in: ["USER_CREATED", "LOGIN", "LOGIN_FAILED"] } }] } });
  await db.$disconnect();
}

console.log(failures === 0 ? "\nTodo en orden ✔" : `\n${failures} verificación(es) fallaron ✘`);
process.exit(failures === 0 ? 0 : 1);

/** Mismo texto que muestra el botón de cada día en el turnero (ej. "Lun, 19 oct"). */
function dayLabel(date: string) {
  const text = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
