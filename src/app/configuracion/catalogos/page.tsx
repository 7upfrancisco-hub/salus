import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Check, Field, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { saveCoverage, saveOffice, saveSpecialty } from "./actions";

export const metadata: Metadata = { title: "Coberturas, especialidades y consultorios" };

export default async function CatalogsPage() {
  const user = await requireAdmin();
  const [coverages, specialties, offices] = await Promise.all([
    db.coverage.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.specialty.findMany({ orderBy: { name: "asc" } }),
    db.office.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold tracking-tight">Coberturas, especialidades y consultorios</h1>

      <div className="space-y-8">
        <Card title="Coberturas" description="Obras sociales, prepagas y atención particular. El color identifica sus turnos en la agenda. Desactivar una cobertura la oculta del turnero sin borrar su historial.">
          <ul className="space-y-3">
            {coverages.map((c) => (
              <li key={c.id} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <ActionForm action={saveCoverage} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Nombre" htmlFor={`cn-${c.id}`}><TextInput id={`cn-${c.id}`} name="name" defaultValue={c.name} required className="w-44" /></Field>
                  <Field label="Color" htmlFor={`cc-${c.id}`}><TextInput id={`cc-${c.id}`} name="color" type="color" defaultValue={c.color} className="h-10 w-16 p-1" /></Field>
                  <Field label="Orden" htmlFor={`co-${c.id}`}><TextInput id={`co-${c.id}`} name="sortOrder" type="number" min={0} defaultValue={c.sortOrder} className="w-20" /></Field>
                  <Check name="isParticular" label="Es particular" defaultChecked={c.isParticular} />
                  <Check name="active" label="Activa" defaultChecked={c.active} />
                </ActionForm>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium">Agregar cobertura</p>
            <ActionForm action={saveCoverage} resetOnSuccess submitLabel="Agregar" className="flex flex-wrap items-end gap-3">
              <Field label="Nombre" htmlFor="new-cn"><TextInput id="new-cn" name="name" required className="w-44" /></Field>
              <Field label="Color" htmlFor="new-cc"><TextInput id="new-cc" name="color" type="color" defaultValue="#7c3aed" className="h-10 w-16 p-1" /></Field>
              <Field label="Orden" htmlFor="new-co"><TextInput id="new-co" name="sortOrder" type="number" min={0} defaultValue={coverages.length} className="w-20" /></Field>
              <Check name="isParticular" label="Es particular" />
              <input type="hidden" name="active" value="on" />
            </ActionForm>
          </div>
        </Card>

        <Card title="Especialidades" description="Si una especialidad atiende solo cierto rango de edad (por ejemplo, pediatría), el sistema valida la edad del paciente al sacar el turno.">
          <ul className="space-y-3">
            {specialties.map((s) => (
              <li key={s.id} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <ActionForm action={saveSpecialty} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={s.id} />
                  <Field label="Nombre" htmlFor={`sn-${s.id}`}><TextInput id={`sn-${s.id}`} name="name" defaultValue={s.name} required className="w-44" /></Field>
                  <Field label="Edad mín." htmlFor={`smin-${s.id}`}><TextInput id={`smin-${s.id}`} name="minAgeYears" type="number" min={0} max={120} defaultValue={s.minAgeYears ?? ""} className="w-24" /></Field>
                  <Field label="Edad máx." htmlFor={`smax-${s.id}`}><TextInput id={`smax-${s.id}`} name="maxAgeYears" type="number" min={0} max={120} defaultValue={s.maxAgeYears ?? ""} className="w-24" /></Field>
                  <Check name="active" label="Activa" defaultChecked={s.active} />
                </ActionForm>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium">Agregar especialidad</p>
            <ActionForm action={saveSpecialty} resetOnSuccess submitLabel="Agregar" className="flex flex-wrap items-end gap-3">
              <Field label="Nombre" htmlFor="new-sn"><TextInput id="new-sn" name="name" required className="w-44" /></Field>
              <Field label="Edad mín." htmlFor="new-smin"><TextInput id="new-smin" name="minAgeYears" type="number" min={0} max={120} className="w-24" /></Field>
              <Field label="Edad máx." htmlFor="new-smax"><TextInput id="new-smax" name="maxAgeYears" type="number" min={0} max={120} className="w-24" /></Field>
              <input type="hidden" name="active" value="on" />
            </ActionForm>
          </div>
        </Card>

        <Card title="Consultorios">
          <ul className="space-y-3">
            {offices.map((o) => (
              <li key={o.id} className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900">
                <ActionForm action={saveOffice} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={o.id} />
                  <Field label="Nombre" htmlFor={`on-${o.id}`}><TextInput id={`on-${o.id}`} name="name" defaultValue={o.name} required className="w-48" /></Field>
                  <Check name="active" label="Activo" defaultChecked={o.active} />
                </ActionForm>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium">Agregar consultorio</p>
            <ActionForm action={saveOffice} resetOnSuccess submitLabel="Agregar" className="flex flex-wrap items-end gap-3">
              <Field label="Nombre" htmlFor="new-on"><TextInput id="new-on" name="name" required className="w-48" /></Field>
              <input type="hidden" name="active" value="on" />
            </ActionForm>
          </div>
        </Card>
      </div>
    </StaffShell>
  );
}
