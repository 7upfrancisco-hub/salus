import "server-only";
import { db } from "@/lib/db";

type Client = Pick<typeof db, "auditLog">;

/**
 * Registra quién hizo qué. El registro es de solo agregado: nada en la app lo edita ni lo borra.
 * Acepta un cliente de transacción para que el registro se guarde junto con el cambio auditado.
 */
export async function audit(
  entry: {
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
  client: Client = db,
) {
  await client.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
    },
  });
}
