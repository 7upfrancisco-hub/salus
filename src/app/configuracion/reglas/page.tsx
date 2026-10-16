import type { Metadata } from "next";
import Link from "next/link";
import { CoverageTag } from "@/components/agenda-parts";
import { StaffShell } from "@/components/staff-shell";
import { getManageableProfessionals } from "@/lib/access";
import { isGlobalEditor, requireConfigUser } from "@/lib/config-access";
import { db } from "@/lib/db";
import { summarizeQuotas, summarizeWindows } from "@/lib/rule-summary";

export const metadata: Metadata = { title: "Reglas por cobertura" };

export default async function RulesPage() {
  const user = await requireConfigUser();
  const professionals = await getManageableProfessionals(user);
  const specialtyIds = [...new Set(professionals.map((p) => p.specialtyId))];

  const [rules, coverages] = await Promise.all([
    db.coverageRule.findMany({
      where: { OR: [{ professionalId: { in: professionals.map((p) => p.id) } }, { specialtyId: { in: specialtyIds } }] },
      include: { coverage: true, windows: true, quotas: true, requirements: true },
      orderBy: { coverage: { sortOrder: "asc" } },
    }),
    db.coverage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const global = isGlobalEditor(user);

  return (
    <StaffShell user={user}>
      <Link href="/configuracion" className="text-sm text-zinc-500 hover:text-foreground">← Configuración</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reglas por cobertura</h1>
          <p className="text-sm text-zinc-500">
            Define a quién atiende cada profesional y cómo: franjas, cupos y requisitos. Un profesional sin regla para
            una cobertura no la atiende.
          </p>
        </div>
        <Link href="/configuracion/reglas/nueva" className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
          Nueva regla
        </Link>
      </div>

      {professionals.length === 0 ? (
        <p className="text-sm text-zinc-500">No tenés agendas asignadas.</p>
      ) : (
        <div className="space-y-6">
          {professionals.map((professional) => {
            const own = rules.filter((r) => r.professionalId === professional.id);
            const inherited = rules.filter((r) => r.specialtyId === professional.specialtyId && !own.some((o) => o.coverageId === r.coverageId));
            const covered = new Set([...own, ...inherited].map((r) => r.coverageId));
            const missing = coverages.filter((c) => !covered.has(c.id));

            return (
              <section key={professional.id} className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
                <h2 className="text-lg font-semibold">
                  {professional.name} <span className="text-sm font-normal text-zinc-500">· {professional.specialty.name}</span>
                </h2>

                {own.length + inherited.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">No atiende ninguna cobertura todavía.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                    {[...own, ...inherited].map((rule) => {
                      const editable = rule.professionalId ? true : global;
                      const quotas = rule.quotas.map((q) => ({ period: q.period, max: q.max, scope: q.scope, weekdays: q.weekdays ? q.weekdays.split(",").map(Number) : null }));
                      return (
                        <li key={rule.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 py-3 ${rule.active ? "" : "opacity-60"}`}>
                          <div className="w-28 shrink-0 pt-0.5">
                            <CoverageTag coverage={rule.coverage} />
                          </div>
                          <div className="min-w-0 flex-1 text-sm">
                            <p>{summarizeWindows(rule.windows)}</p>
                            <p className="text-zinc-500">
                              {summarizeQuotas(quotas)}
                              {rule.requirements.length > 0 ? ` · ${rule.requirements.length} requisito(s)` : ""}
                              {rule.firstVisitMinutes ? ` · primera vez ${rule.firstVisitMinutes} min` : ""}
                              {!rule.active ? " · INACTIVA" : ""}
                              {!rule.professionalId ? " · regla de toda la especialidad" : ""}
                            </p>
                          </div>
                          {editable ? (
                            <Link href={`/configuracion/reglas/${rule.id}`} className="text-sm text-teal-700 hover:underline">
                              Editar
                            </Link>
                          ) : (
                            <span className="text-xs text-zinc-500">La edita administración</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {missing.length > 0 && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                    No atiende:
                    {missing.map((c) => (
                      <Link
                        key={c.id}
                        href={`/configuracion/reglas/nueva?profesional=${professional.id}&cobertura=${c.id}`}
                        className="rounded-full border border-dashed border-zinc-400 px-2.5 py-0.5 text-xs hover:border-teal-600 hover:text-teal-700"
                        title={`Agregar regla de ${c.name}`}
                      >
                        + {c.name}
                      </Link>
                    ))}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </StaffShell>
  );
}
