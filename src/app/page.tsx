import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { cardClass } from "@/components/ui";
import { accountPeople, getCurrentAccount } from "@/lib/patient-auth";
import { listCoverages } from "@/lib/public";
import { BookingWizard } from "./booking-wizard";

// Las coberturas y los datos del centro se editan desde Configuración: la página nunca debe quedar congelada.
export const dynamic = "force-dynamic";

export default async function Home() {
  const account = await getCurrentAccount();
  const coverages = account ? await listCoverages() : [];

  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Sacá tu turno</h1>
        {account ? (
          <>
            <p className="mb-6 text-sm text-zinc-500">Elegí tu cobertura y te mostramos solo los turnos que podés tomar.</p>
            <BookingWizard coverages={coverages} people={accountPeople(account)} />
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-zinc-500">Para sacar un turno online ingresá con tu DNI.</p>
            <div className={`${cardClass} space-y-4`}>
              <Link href="/ingresar" className="block w-full rounded-lg bg-teal-600 px-4 py-3 text-center font-medium text-white transition hover:bg-teal-700">
                Ingresar
              </Link>
              <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
                ¿Es tu primera vez?{" "}
                <Link href="/registro" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                  Creá tu cuenta
                </Link>{" "}
                con tu DNI: es rápido y la hacés una sola vez.
              </p>
            </div>
          </>
        )}
      </main>

      <PublicFooter />
    </div>
  );
}
