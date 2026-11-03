import Link from "next/link";
import { logoutAccount } from "@/app/cuenta/actions";
import { db } from "@/lib/db";
import { getCurrentAccount } from "@/lib/patient-auth";

/** Encabezado de las pantallas públicas: el nombre del centro y, según corresponda, ingresar o la cuenta del paciente. */
export async function PublicHeader({ subtitle = "Turnos online" }: { subtitle?: string }) {
  const [settings, account] = await Promise.all([db.centerSettings.findUnique({ where: { id: 1 } }), getCurrentAccount()]);
  const centerName = settings?.name ?? "Salus";

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="text-2xl font-bold tracking-tight">
          {centerName === "Salus" ? (
            <>
              Sal<span className="text-teal-600">us</span>
            </>
          ) : (
            centerName
          )}
        </Link>
        {account ? (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/cuenta" className="max-w-40 truncate font-medium text-teal-700 hover:underline dark:text-teal-400">
              {account.patient.firstName}
            </Link>
            <form action={logoutAccount}>
              <button type="submit" className="text-zinc-500 hover:text-foreground hover:underline">
                Salir
              </button>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-500 sm:inline">{subtitle}</span>
            <Link href="/ingresar" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Ingresar
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
      <Link href="/login" className="hover:underline">
        Ingreso del personal
      </Link>
    </footer>
  );
}
