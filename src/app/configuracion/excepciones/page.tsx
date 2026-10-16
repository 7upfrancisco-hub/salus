import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ConfirmActionButton } from "@/components/confirm-action-button";
import { Card, Check, Field, Select, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { getManageableProfessionals } from "@/lib/access";
import { isGlobalEditor, requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { capitalizeFirst, minutesToTime, todayInZone } from "@/lib/time";
import { createException, deleteAllowance, deleteException, saveAllowance } from "./actions";

export const metadata: Metadata = { title: "Feriados, licencias y bloqueos" };

const KIND_LABEL: Record<string, string> = { HOLIDAY: "Feriado", LEAVE: "Licencia", BLOCK: "Bloqueo" };
const dateText = (date: string) =>
  capitalizeFirst(
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`)),
  );

export default async function ExceptionsPage() {
  const user = await requireConfigUser();
  const global = isGlobalEditor(user);
  const professionals = await getManageableProfessionals(user);
  const ids = professionals.map((p) => p.id);
  const names = new Map(professionals.map((p) => [p.id, p.name]));

  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });
  const today = todayInZone(settings?.timezone ?? "America/Argentina/Buenos_Aires");

  const [exceptions, allowances] = await Promise.all([
    db.scheduleException.findMany({
      where: { dateTo: { gte: today }, OR: [{ professionalId: { in: ids } }, { professionalId: null }] },
      orderBy: { dateFrom: "asc" },
    }),
    db.overbookAllowance.findMany({ where: { date: { gte: today }, professionalId: { in: ids } }, orderBy: { date: "asc" } }),
  ]);

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Feriados, licencias y bloqueos</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Días u horarios en que no se dan turnos. Los turnos que ya estaban dados no se cancelan solos: el sistema te avisa cuántos quedaron afectados.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card title="Próximos días sin atención">
            {exceptions.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay días bloqueados.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {exceptions.map((e) => {
                  const canDelete = e.professionalId ? ids.includes(e.professionalId) : global;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                      <div>
                        <p className="font-medium">
                          <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{KIND_LABEL[e.kind]}</span>
                          <span>{dateText(e.dateFrom)}</span>
                          {e.dateTo !== e.dateFrom && <span> → {dateText(e.dateTo)}</span>}
                          {e.startMinutes !== null && e.endMinutes !== null && <span> · {minutesToTime(e.startMinutes)}–{minutesToTime(e.endMinutes)}</span>}
                        </p>
                        <p className="text-zinc-500">
                          {e.professionalId ? (names.get(e.professionalId) ?? "Otro profesional") : "Todo el centro"}
                          {e.note ? ` · ${e.note}` : ""}
                        </p>
                      </div>
                      {canDelete && (
                        <ConfirmActionButton action={deleteException.bind(null, e.id)} label="Quitar" confirmMessage="¿Quitar este bloqueo? Esos días vuelven a ofrecer turnos." />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Sobreturnos habilitados" description="Cuántos turnos extra puede dar la secretaría un día puntual, por encima de la agenda normal.">
            {allowances.length === 0 ? (
              <p className="text-sm text-zinc-500">No hay sobreturnos habilitados.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {allowances.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{dateText(a.date)}</span> · {names.get(a.professionalId)} · hasta {a.maxExtra}
                      {a.note ? ` · ${a.note}` : ""}
                    </span>
                    <ConfirmActionButton action={deleteAllowance.bind(null, a.id)} label="Quitar" confirmMessage="¿Quitar los sobreturnos habilitados de ese día?" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Bloquear días">
            <ActionForm action={createException} submitLabel="Bloquear" resetOnSuccess>
              <Field label="Tipo" htmlFor="kind">
                <Select id="kind" defaultValue="LEAVE">
                  {global && <option value="HOLIDAY">Feriado (todo el centro)</option>}
                  <option value="LEAVE">Licencia de un profesional</option>
                  <option value="BLOCK">Bloqueo puntual</option>
                </Select>
              </Field>
              <Field label="Profesional" htmlFor="professionalId" hint={global ? "Dejá «Todo el centro» para un feriado." : undefined}>
                <Select id="professionalId" defaultValue={professionals[0]?.id ?? ""}>
                  {global && <option value="">Todo el centro</option>}
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desde" htmlFor="dateFrom">
                  <TextInput id="dateFrom" type="date" min={today} required />
                </Field>
                <Field label="Hasta (opcional)" htmlFor="dateTo">
                  <TextInput id="dateTo" type="date" min={today} />
                </Field>
              </div>
              <Check name="partial" label="Solo una franja horaria" hint="Si no, se bloquea el día completo." />
              <div className="grid grid-cols-2 gap-3">
                <Field label="De" htmlFor="start">
                  <TextInput id="start" type="time" />
                </Field>
                <Field label="A" htmlFor="end">
                  <TextInput id="end" type="time" />
                </Field>
              </div>
              <Field label="Motivo (opcional)" htmlFor="note">
                <TextInput id="note" maxLength={120} placeholder="Congreso, vacaciones, feriado…" />
              </Field>
            </ActionForm>
          </Card>

          <Card title="Habilitar sobreturnos">
            <ActionForm action={saveAllowance} submitLabel="Habilitar" resetOnSuccess>
              <Field label="Profesional" htmlFor="allowanceProfessional">
                <Select id="allowanceProfessional" name="professionalId" defaultValue={professionals[0]?.id ?? ""}>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Día" htmlFor="allowanceDate">
                  <TextInput id="allowanceDate" name="date" type="date" min={today} required />
                </Field>
                <Field label="Cantidad máxima" htmlFor="allowanceMax">
                  <TextInput id="allowanceMax" name="maxExtra" type="number" min={1} max={20} defaultValue={2} required />
                </Field>
              </div>
              <Field label="Motivo (opcional)" htmlFor="allowanceNote">
                <TextInput id="allowanceNote" name="note" maxLength={120} />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </div>
    </StaffShell>
  );
}
