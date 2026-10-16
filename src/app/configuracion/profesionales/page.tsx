import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Check, Field, Select, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { db } from "@/lib/db";
import { saveProfessional } from "./actions";

export const metadata: Metadata = { title: "Profesionales" };

export default async function ProfessionalsPage() {
  const user = await requireAdmin();
  const [professionals, specialties] = await Promise.all([
    db.professional.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { specialty: true } }),
    db.specialty.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const fields = (p?: (typeof professionals)[number]) => {
    const key = p?.id ?? "new";
    return (
      <>
        {p && <input type="hidden" name="id" value={p.id} />}
        <Field label="Nombre" htmlFor={`pn-${key}`}><TextInput id={`pn-${key}`} name="name" defaultValue={p?.name} required className="w-48" /></Field>
        <Field label="Matrícula" htmlFor={`pl-${key}`}><TextInput id={`pl-${key}`} name="licenseNumber" defaultValue={p?.licenseNumber ?? ""} className="w-32" /></Field>
        <Field label="Especialidad" htmlFor={`ps-${key}`}>
          <Select id={`ps-${key}`} name="specialtyId" defaultValue={p?.specialtyId ?? specialties[0]?.id} className="w-44">
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {p && !specialties.some((s) => s.id === p.specialtyId) && <option value={p.specialtyId}>{p.specialty.name} (inactiva)</option>}
          </Select>
        </Field>
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
