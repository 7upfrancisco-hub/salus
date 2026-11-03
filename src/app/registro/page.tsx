import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicFooter, PublicHeader } from "@/components/public-header";
import { cardClass } from "@/components/ui";
import { getCurrentAccount } from "@/lib/patient-auth";
import { RegisterForm } from "../cuenta/forms";

export const metadata: Metadata = { title: "Crear cuenta" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ dni?: string }> }) {
  if (await getCurrentAccount()) redirect("/");
  // Llega con el DNI ya escrito cuando se intentó ingresar con un DNI sin cuenta.
  const { dni } = await searchParams;
  const defaultDni = /^\d{6,9}$/.test(dni ?? "") ? dni : undefined;

  return (
    <div className="flex flex-1 flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">Creá tu cuenta</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Es una sola vez. Después ingresás solo con tu DNI, ves tus turnos y podés sacarlos también para tus hijos.
        </p>
        <div className={cardClass}>
          <RegisterForm defaultDni={defaultDni} />
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          La primera vez que vengas al centro, presentá tu DNI: así verificamos tu cuenta y podés tener más turnos a la vez.
        </p>
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          ¿Ya tenés cuenta?{" "}
          <Link href="/ingresar" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Ingresá
          </Link>
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
