import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Check, Field, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { inputClass } from "@/components/ui";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { saveStudy } from "./actions";

export const metadata: Metadata = { title: "Estudios preocupacionales" };

export default async function StudiesPage() {
  const user = await requireAdmin();
  const [studies, rules] = await Promise.all([
    db.occupationalStudy.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.coverageRule.count({ where: { active: true, coverage: { isOccupational: true } } }),
  ]);
  const activeStudies = studies.filter((s) => s.active).length;

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold tracking-tight">Estudios preocupacionales</h1>

      <div className="space-y-8">
        {(activeStudies === 0 || rules === 0) && (
          <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>El turno preocupacional todavía no se ofrece online.</strong> Falta:
            <ul className="mt-1 list-inside list-disc">
              {activeStudies === 0 && <li>cargar al menos un estudio activo (abajo);</li>}
              {rules === 0 && (
                <li>
                  que algún profesional atienda preocupacionales: en{" "}
                  <Link href="/configuracion/reglas" className="underline">Reglas por cobertura</Link> creale una regla con la
                  cobertura «Preocupacional» (franjas horarias y cupos).
                </li>
              )}
            </ul>
          </div>
        )}

        <Card
          title="Estudios"
          description="Son las opciones que ve el paciente al elegir «Preocupacional». Todos los estudios comparten la agenda de los profesionales que atienden preocupacionales. Un estudio no se borra: se desactiva, así no se pierde el historial de los turnos ya dados."
        >
          <ul className="space-y-3">
            {studies.map((s) => (
              <li key={s.id} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <ActionForm action={saveStudy} className="space-y-3">
                  <input type="hidden" name="id" value={s.id} />
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Nombre" htmlFor={`stn-${s.id}`}><TextInput id={`stn-${s.id}`} name="name" defaultValue={s.name} required className="w-56" /></Field>
                    <Field label="Orden" htmlFor={`sto-${s.id}`}><TextInput id={`sto-${s.id}`} name="sortOrder" type="number" min={0} defaultValue={s.sortOrder} className="w-20" /></Field>
                    <Check name="active" label="Activo" defaultChecked={s.active} />
                  </div>
                  <StudyTextFields id={s.id} description={s.description} instructions={s.instructions} />
                </ActionForm>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium">Agregar estudio</p>
            <ActionForm action={saveStudy} resetOnSuccess submitLabel="Agregar" className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Nombre" htmlFor="new-stn"><TextInput id="new-stn" name="name" required className="w-56" /></Field>
                <Field label="Orden" htmlFor="new-sto"><TextInput id="new-sto" name="sortOrder" type="number" min={0} defaultValue={studies.length} className="w-20" /></Field>
              </div>
              <StudyTextFields id="new" description={null} instructions={null} />
              <input type="hidden" name="active" value="on" />
            </ActionForm>
          </div>
        </Card>
      </div>
    </StaffShell>
  );
}

function StudyTextFields({ id, description, instructions }: { id: string; description: string | null; instructions: string | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Descripción corta" htmlFor={`std-${id}`} hint="Se muestra debajo del nombre al elegirlo (opcional).">
        <TextInput id={`std-${id}`} name="description" defaultValue={description ?? ""} maxLength={120} />
      </Field>
      <Field label="Qué traer o cómo prepararse" htmlFor={`sti-${id}`} hint="Una indicación por línea. Se muestra al reservar, en el turno y en los mails (opcional).">
        <textarea id={`sti-${id}`} name="instructions" rows={3} maxLength={600} defaultValue={instructions ?? ""} className={inputClass} />
      </Field>
    </div>
  );
}
