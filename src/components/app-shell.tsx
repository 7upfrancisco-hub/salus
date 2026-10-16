import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";

export function AppShell({
  userName,
  subtitle,
  nav = [],
  children,
}: {
  userName: string;
  subtitle: string;
  nav?: { href: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Sal<span className="text-teal-600">us</span>
          </Link>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {subtitle}
          </span>
          <nav className="flex gap-4 text-sm">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="text-zinc-600 hover:text-foreground dark:text-zinc-400">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-500">{userName}</span>
            <form action={logout}>
              <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
