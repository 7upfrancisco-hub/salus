import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { cardClass } from "@/components/ui";
import { getCurrentAccount } from "@/lib/patient-auth";
import { LoginForm } from "../cuenta/forms";

export const metadata: Metadata = { title: "Ingresar" };
export const dynamic = "force-dynamic";

export default async function PatientLoginPage() {
  if (await getCurrentAccount()) redirect("/");

  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-sm flex-1 px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Ingresá para sacar tu turno</h1>
        <p className="mb-6 text-sm text-zinc-500">Con tu DNI y tu contraseña.</p>
        <div className={cardClass}>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          ¿Es tu primera vez?{" "}
          <Link href="/registro" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Creá tu cuenta
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-zinc-500">
          ¿Olvidaste tu contraseña? Comunicate con el centro y te la restablecemos.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
