import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor());

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-3xl font-bold tracking-tight">
          Sal<span className="text-teal-600">us</span>
        </h1>
        <p className="mb-8 text-center text-sm text-zinc-500">Ingreso del personal</p>
        <div className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
