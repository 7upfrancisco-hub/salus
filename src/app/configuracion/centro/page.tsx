import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Field, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { saveSettings } from "./actions";

export const metadata: Metadata = { title: "Datos del centro" };

export default async function CenterSettingsPage() {
  const user = await requireAdmin();
  const settings = await db.centerSettings.findUnique({ where: { id: 1 } });

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold tracking-tight">Datos del centro</h1>

      <div className="max-w-2xl">
        <Card title="Turnero online y avisos" description="Estos valores se aplican a los turnos que reservan los pacientes desde la web. La secretaría puede dar turnos sin estos límites.">
          <ActionForm action={saveSettings}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre del centro" htmlFor="name" className="sm:col-span-2"><TextInput id="name" defaultValue={settings?.name ?? "Salus"} required /></Field>
              <Field label="Zona horaria" htmlFor="timezone" className="sm:col-span-2" hint="Define la hora de todos los turnos y recordatorios."><TextInput id="timezone" defaultValue={settings?.timezone ?? "America/Argentina/Buenos_Aires"} required /></Field>
              <Field label="Se puede reservar hasta (días)" htmlFor="bookingHorizonDays" hint="Cuántos días hacia adelante ven turnos los pacientes."><TextInput id="bookingHorizonDays" type="number" min={1} max={365} defaultValue={settings?.bookingHorizonDays ?? 60} required /></Field>
              <Field label="Anticipación mínima (horas)" htmlFor="minNoticeHours" hint="Con cuánta antelación como mínimo se puede reservar online."><TextInput id="minNoticeHours" type="number" min={0} max={720} defaultValue={settings?.minNoticeHours ?? 2} required /></Field>
              <Field label="Cancelación online hasta (horas antes)" htmlFor="cancelLimitHours" hint="Pasado ese límite el paciente debe llamar al centro."><TextInput id="cancelLimitHours" type="number" min={0} max={720} defaultValue={settings?.cancelLimitHours ?? 12} required /></Field>
              <Field label="Recordatorio por mail (horas antes)" htmlFor="reminderHoursBefore" hint="Cuántas horas antes del turno se envía el aviso."><TextInput id="reminderHoursBefore" type="number" min={1} max={168} defaultValue={settings?.reminderHoursBefore ?? 24} required /></Field>
            </div>
          </ActionForm>
        </Card>

        <div className="mt-6 rounded-2xl border border-zinc-200 p-5 text-sm dark:border-zinc-800">
          <h2 className="mb-1 text-lg font-semibold">Envío de mails</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Los avisos se envían con Resend. Para activarlos hay que configurar en el servidor las variables{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">RESEND_API_KEY</code>,{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">MAIL_FROM</code> y{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">CRON_SECRET</code>, y programar una llamada cada pocos
            minutos a <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/api/cron/notificaciones</code>. Mientras tanto,
            los avisos quedan en cola y no se envía ninguno.
          </p>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Estado actual: {process.env.RESEND_API_KEY && process.env.MAIL_FROM ? "configurado ✓" : "sin configurar (no se envían mails)"}.
          </p>
        </div>
      </div>
    </StaffShell>
  );
}
