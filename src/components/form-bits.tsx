import type { ReactNode } from "react";
import { inputBase } from "@/components/ui";

/** Campo a todo el ancho, salvo que se le indique un ancho propio (w-44…). */
const fieldClass = (className = "") => `${inputBase} ${/(^|\s)w-/.test(className) ? "" : "w-full"} ${className}`;

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  return <input name={props.id} {...props} className={fieldClass(props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { id: string }) {
  return <select name={props.id} {...props} className={fieldClass(props.className)} />;
}

export function Check({
  name,
  label,
  defaultChecked,
  hint,
  value,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
  value?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-1 h-4 w-4 accent-teal-600" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mb-4 mt-0.5 text-sm text-zinc-500">{description}</p>}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  );
}
