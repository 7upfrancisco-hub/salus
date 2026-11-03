import type { Metadata } from "next";
import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { cardClass } from "@/components/ui";
import { ACCOUNT_MAX_ACTIVE, ACCOUNT_RELATION_LABEL, APPOINTMENT_STATUS, MAX_DEPENDENTS } from "@/lib/constants";
import { db } from "@/lib/db";
import { formatWhen } from "@/lib/email-templates";
import { requireAccount } from "@/lib/patient-auth";
import { specialtyNames } from "@/lib/specialties";
import { APPOINTMENT_STATUS_LABEL } from "@/lib/status-labels";
import { FamilyForm, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Mi cuenta", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = {
  RESERVED: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-800",
};

export default async function AccountPage() {
  const account = await requireAccount();
  const [settings, appointments] = await Promise.all([
    db.centerSettings.findUnique({ where: { id: 1 } }),
    db.appointment.findMany({
      where: { accountId: account.id },
      orderBy: { startsAt: "desc" },
      take: 40,
      include: { professional: { include: { specialties: true } }, coverage: true, patient: true },
    }),
  ]);
  const timezone = settings?.timezone ?? "America/Argentina/Buenos_Aires";
  const now = new Date();
  const isActive = (status: string) => status === APPOINTMENT_STATUS.RESERVED || status === APPOINTMENT_STATUS.CONFIRMED;
  const upcoming = appointments.filter((a) => isActive(a.status) && a.startsAt > now).reverse();
  const past = appointments.filter((a) => !upcoming.includes(a));
  const maxActive = account.verifiedAt ? ACCOUNT_MAX_ACTIVE.VERIFIED : ACCOUNT_MAX_ACTIVE.UNVERIFIED;

  const appointmentRow = (a: (typeof appointments)[number]) => (
    <li key={a.id}>
      <Link href={`/turno/${a.manageToken}`} className="block rounded-xl border border-zinc-200 p-3 text-sm transition hover:border-teal-600 dark:border-zinc-800">
        <span className="flex items-center justify-between gap-2">
          <strong>{formatWhen(a.startsAt, timezone)} hs</strong>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[a.status] ?? "bg-zinc-200 text-zinc-700"}`}>
            {APPOINTMENT_STATUS_LABEL[a.status] ?? a.status}
          </span>
        </span>
        <span className="block text-zinc-600 dark:text-zinc-400">
          {a.professional.name} · {specialtyNames(a.professional)} · {a.coverage.name}
        </span>
        <span className="block text-xs text-zinc-500">Paciente: {a.patient.firstName} {a.patient.lastName}</span>
      </Link>
    </li>
  );

  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {account.patient.firstName} {account.patient.lastName}
          </h1>
          <p className="text-sm text-zinc-500">DNI {account.dni}</p>
          <p className="mt-2 text-sm">
            {account.verifiedAt ? (
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">Cuenta verificada</span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">Cuenta sin verificar</span>
            )}
          </p>
          {!account.verifiedAt && (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Presentá tu DNI en el centro y verificamos tu cuenta. Hasta entonces podés tener {maxActive} turnos pendientes a la vez.
            </p>
          )}
          <Link href="/" className="mt-4 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">
            Sacar un turno
          </Link>
        </div>

        <section className={cardClass}>
          <h2 className="mb-3 text-lg font-semibold">Mis próximos turnos</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-zinc-500">No tenés turnos pendientes.</p>
          ) : (
            <ul className="space-y-2">{upcoming.map(appointmentRow)}</ul>
          )}
        </section>

        {past.length > 0 && (
          <section className={cardClass}>
            <h2 className="mb-3 text-lg font-semibold">Turnos anteriores</h2>
            <ul className="space-y-2">{past.map(appointmentRow)}</ul>
          </section>
        )}

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Personas a cargo</h2>
          <p className="mb-3 mt-0.5 text-sm text-zinc-500">
            Agregá a tus hijos u otras personas a cargo para sacarles turno desde tu cuenta (hasta {MAX_DEPENDENTS}). Los avisos te llegan a vos.
          </p>
          {account.dependents.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {account.dependents.map((d) => (
                <li key={d.patientId} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                  <strong>{d.patient.firstName} {d.patient.lastName}</strong> · DNI {d.patient.dni} ·{" "}
                  <span className="text-zinc-500">{ACCOUNT_RELATION_LABEL[d.relation] ?? d.relation}</span>
                </li>
              ))}
            </ul>
          )}
          {account.dependents.length < MAX_DEPENDENTS ? (
            <FamilyForm />
          ) : (
            <p className="text-sm text-zinc-500">Llegaste al máximo de personas a cargo.</p>
          )}
        </section>

        <section className={cardClass}>
          <h2 className="mb-3 text-lg font-semibold">Cambiar contraseña</h2>
          <PasswordForm />
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
