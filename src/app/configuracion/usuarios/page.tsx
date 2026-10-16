import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Check, Field, Select, TextInput } from "@/components/form-bits";
import { StaffShell } from "@/components/staff-shell";
import { requireAdmin } from "@/lib/config-access";
import { ROLES } from "@/lib/constants";
import { db } from "@/lib/db";
import { createUser, updateUser } from "./actions";

export const metadata: Metadata = { title: "Usuarios" };

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administración", SECRETARY: "Secretaría", PROFESSIONAL: "Profesional" };

export default async function UsersPage() {
  const admin = await requireAdmin();
  const [users, professionals] = await Promise.all([
    db.user.findMany({ orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }], include: { access: true, professional: true } }),
    db.professional.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { specialty: true } }),
  ]);

  const accessChecks = (selected: string[], prefix: string) => (
    <fieldset className="basis-full">
      <legend className="mb-1 text-xs font-medium">Agendas que gestiona (secretaría)</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {professionals.map((p) => (
          <Check key={`${prefix}-${p.id}`} name="access" value={p.id} label={p.name} defaultChecked={selected.includes(p.id)} />
        ))}
      </div>
    </fieldset>
  );

  return (
    <StaffShell user={admin}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Usuarios</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Quién puede entrar al sistema. El personal de secretaría ve y gestiona solo las agendas que le asignes, o todas si marcás
        «Gestiona todo el centro». Un profesional ve únicamente la suya.
      </p>

      <div className="space-y-6">
        <Card title="Usuarios actuales">
          <ul className="space-y-3">
            {users.map((u) => (
              <li key={u.id} className={`rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900 ${u.active ? "" : "opacity-70"}`}>
                <p className="mb-3 text-sm">
                  <strong>{u.email}</strong> · {ROLE_LABEL[u.role]}
                  {u.id === admin.id && <span className="ml-2 text-xs text-zinc-500">(vos)</span>}
                </p>
                <ActionForm action={updateUser} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={u.id} />
                  <Field label="Nombre" htmlFor={`un-${u.id}`}><TextInput id={`un-${u.id}`} name="name" defaultValue={u.name} required className="w-52" /></Field>
                  <Field label="Nueva contraseña" htmlFor={`up-${u.id}`} hint="Dejala vacía para no cambiarla">
                    <TextInput id={`up-${u.id}`} name="newPassword" type="password" autoComplete="new-password" minLength={10} className="w-52" />
                  </Field>
                  {u.role === ROLES.PROFESSIONAL && (
                    <Field label="Profesional" htmlFor={`upr-${u.id}`}>
                      <Select id={`upr-${u.id}`} name="professionalId" defaultValue={u.professional?.id ?? ""} className="w-48">
                        <option value="">Sin vincular</option>
                        {professionals.filter((p) => !p.userId || p.userId === u.id).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {u.role !== ROLES.ADMIN && <Check name="manageAll" label="Gestiona todo el centro" defaultChecked={u.manageAll} />}
                  <Check name="active" label="Activo" defaultChecked={u.active} />
                  {u.role === ROLES.SECRETARY && accessChecks(u.access.map((a) => a.professionalId), u.id)}
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Agregar usuario" description="La contraseña inicial se la pasás a la persona, que después puede pedir que se la cambien (mínimo 10 caracteres).">
          <ActionForm action={createUser} resetOnSuccess submitLabel="Crear usuario" className="flex flex-wrap items-end gap-3">
            <Field label="Nombre" htmlFor="nu-name"><TextInput id="nu-name" name="name" required className="w-52" /></Field>
            <Field label="Email" htmlFor="nu-email"><TextInput id="nu-email" name="email" type="email" required className="w-60" /></Field>
            <Field label="Contraseña inicial" htmlFor="nu-pass"><TextInput id="nu-pass" name="password" type="text" autoComplete="off" minLength={10} required className="w-52" /></Field>
            <Field label="Rol" htmlFor="nu-role">
              <Select id="nu-role" name="role" defaultValue="SECRETARY" className="w-44">
                <option value="SECRETARY">Secretaría</option>
                <option value="PROFESSIONAL">Profesional</option>
                <option value="ADMIN">Administración</option>
              </Select>
            </Field>
            <Field label="Si es profesional: ¿cuál?" htmlFor="nu-prof">
              <Select id="nu-prof" name="professionalId" defaultValue="" className="w-48">
                <option value="">—</option>
                {professionals.filter((p) => !p.userId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Check name="manageAll" label="Gestiona todo el centro" />
            <input type="hidden" name="active" value="on" />
            {accessChecks([], "new")}
          </ActionForm>
        </Card>
      </div>
    </StaffShell>
  );
}
