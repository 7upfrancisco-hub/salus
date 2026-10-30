import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Check, Field, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { saveProfessional } from "./actions";

export const metadata: Metadata = { title: "Profesionales" };

export default async function ProfessionalsPage() {
  const user = await requireAdmin();
  const [professionals, specialties] = await Promise.all([
    db.professional.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { specialties: true } }),
    db.specialty.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const fields = (p?: (typeof professionals)[number]) => {
    const key = p?.id ?? "new";
    const own = new Set(p?.specialties.map((s) => s.id));
    // Las activas y, si el profesional ya tenía alguna que se desactivó después, esa también (para no perderla al guardar).
    const options = [
      ...specialties.map((s) => ({ id: s.id, name: s.name })),
      ...(p?.specialties ?? []).filter((s) => !specialties.some((a) => a.id === s.id)).map((s) => ({ id: s.id, name: `${s.name} (inactiva)` })),
    ];
    return (
      <>
        {p && <input type="hidden" name="id" value={p.id} />}
        <Field label="Nombre" htmlFor={`pn-${key}`}><TextInput id={`pn-${key}`} name="name" defaultValue={p?.name} required className="w-48" /></Field>
        <Field label="Matrícula" htmlFor={`pl-${key}`}><TextInput id={`pl-${key}`} name="licenseNumber" defaultValue={p?.licenseNumber ?? ""} className="w-32" /></Field>
        <fieldset className="w-72">
          <legend className="mb-1 text-sm font-medium">Especialidades</legend>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-zinc-300 p-2 dark:border-zinc-700">
            {options.map((s) => (
              <Check key={s.id} name="specialtyIds" value={s.id} label={s.name} defaultChecked={own.has(s.id)} />
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-500">Si atiende más de una, comparte la misma agenda en todas.</p>
        </fieldset>
        <Check name="onlineBooking" label="Turnos online" hint="Si no, solo secretaría le da turnos" defaultChecked={p?.onlineBooking ?? true} />
        {p ? <Check name="active" label="Activo" defaultChecked={p.active} /> : <input type="hidden" name="active" value="on" />}
      </>
    );
  };

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Profesionales</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Después de dar de alta a un profesional, cargá su <Link href="/configuracion/horarios" className="text-teal-700 hover:underline">horario de atención</Link> y sus{" "}
        <Link href="/configuracion/reglas" className="text-teal-700 hover:underline">reglas por cobertura</Link>. Sin reglas no atiende ninguna cobertura.
      </p>

      <div className="space-y-6">
        <Card title="Equipo">
          <ul className="space-y-3">
            {professionals.map((p) => (
              <li key={p.id} className={`rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900 ${p.active ? "" : "opacity-70"}`}>
                <ActionForm action={saveProfessional} className="flex flex-wrap items-end gap-3">
                  {fields(p)}
                </ActionForm>
                <p className="mt-2 text-xs">
                  <Link href={`/configuracion/horarios?profesional=${p.id}`} className="text-teal-700 hover:underline">Horarios</Link>
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Agregar profesional">
          <ActionForm action={saveProfessional} resetOnSuccess submitLabel="Agregar" className="flex flex-wrap items-end gap-3">
            {fields()}
          </ActionForm>
        </Card>
      </div>
    </StaffShell>
  );
}
