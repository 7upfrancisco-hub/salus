import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffShell } from "@/components/staff-shell";
import { canManageProfessional, getManageableProfessionals } from "@/lib/access";
import { isGlobalEditor, requireConfigUser } from "@/lib/config-access";
import { QUOTA_SCOPE } from "@/lib/constants";
import { db } from "@/lib/db";
import { DeleteRuleButton } from "../delete-rule-button";
import { RuleEditor, type RuleData } from "../rule-editor";

export const metadata: Metadata = { title: "Regla por cobertura" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function RuleEditPage({ params, searchParams }: PageProps<"/configuracion/reglas/[id]">) {
  const user = await requireConfigUser();
  const { id } = await params;
  const query = await searchParams;
  const global = isGlobalEditor(user);

  const [professionals, coverages] = await Promise.all([
    getManageableProfessionals(user),
    db.coverage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  let rule: RuleData;
  let editingShared = false;

  if (id === "nueva") {
    const professionalId = first(query.profesional);
    const coverageId = first(query.cobertura);
    rule = {
      id: null,
      target: professionalId && professionals.some((p) => p.id === professionalId) ? `p:${professionalId}` : professionals.length === 1 ? `p:${professionals[0].id}` : "",
      coverageId: coverageId && coverages.some((c) => c.id === coverageId) ? coverageId : "",
      active: true,
      notes: "",
      firstVisitMinutes: null,
      controlMinutes: null,
      windows: [],
      quotas: [],
      requirements: [],
    };
  } else {
    const existing = await db.coverageRule.findUnique({
      where: { id },
      include: { windows: true, quotas: true, requirements: { orderBy: { sortOrder: "asc" } } },
    });
    if (!existing) notFound();
    const allowed = existing.professionalId ? await canManageProfessional(user, existing.professionalId) : global;
    if (!allowed) notFound();
    editingShared = existing.quotas.some((q) => q.scope !== QUOTA_SCOPE.PROFESSIONAL);

    rule = {
      id: existing.id,
      target: existing.professionalId ? `p:${existing.professionalId}` : `s:${existing.specialtyId}`,
      coverageId: existing.coverageId,
      active: existing.active,
      notes: existing.notes ?? "",
      firstVisitMinutes: existing.firstVisitMinutes,
      controlMinutes: existing.controlMinutes,
      windows: existing.windows.map((w) => ({ weekday: w.weekday, startMinutes: w.startMinutes, endMinutes: w.endMinutes })),
      quotas: existing.quotas.map((q) => ({ period: q.period, max: q.max, scope: q.scope, weekdays: q.weekdays ? q.weekdays.split(",").map(Number) : [] })),
      requirements: existing.requirements.map((r) => r.text),
    };
  }

  const specialties = global ? await db.specialty.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const targets = [
    ...professionals.map((p) => ({ value: `p:${p.id}`, label: `${p.name} (${p.specialty.name})`, group: "Un profesional" })),
    ...specialties.map((s) => ({ value: `s:${s.id}`, label: `Todos los de ${s.name}`, group: "Toda la especialidad" })),
  ];

  return (
    <StaffShell user={user}>
      <Link href="/configuracion/reglas" className="text-sm text-zinc-500 hover:text-foreground">← Reglas por cobertura</Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold tracking-tight">{rule.id ? "Editar regla" : "Nueva regla"}</h1>

      {!global && editingShared ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Esta regla tiene cupos compartidos entre profesionales: solo administración la puede modificar.
        </p>
      ) : (
        <div className="max-w-3xl space-y-6">
          <RuleEditor key={rule.id ?? "nueva"} rule={rule} targets={targets} coverages={coverages} canShare={global} />
          {rule.id && (
            <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <DeleteRuleButton ruleId={rule.id} />
            </div>
          )}
        </div>
      )}
    </StaffShell>
  );
}
