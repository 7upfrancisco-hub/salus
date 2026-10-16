import Link from "next/link";
import { db } from "@/lib/db";
import { listCoverages } from "@/lib/public";
import { BookingWizard } from "./booking-wizard";

// Las coberturas y los datos del centro se editan desde Configuración: la página nunca debe quedar congelada.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [coverages, settings] = await Promise.all([
    listCoverages(),
    db.centerSettings.findUnique({ where: { id: 1 } }),
  ]);
  const centerName = settings?.name ?? "Salus";

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <span className="text-2xl font-bold tracking-tight">
            {centerName === "Salus" ? (
              <>
                Sal<span className="text-teal-600">us</span>
              </>
            ) : (
              centerName
            )}
          </span>
          <span className="text-sm text-zinc-500">Turnos online</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Sacá tu turno</h1>
        <p className="mb-6 text-sm text-zinc-500">Elegí tu cobertura y te mostramos solo los turnos que podés tomar.</p>
        <BookingWizard coverages={coverages} />
      </main>

      <footer className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
        <Link href="/login" className="hover:underline">
          Ingreso del personal
        </Link>
      </footer>
    </div>
  );
}
