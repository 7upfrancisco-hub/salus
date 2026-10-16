# Salus — turnero del centro de salud

Sistema de turnos para un centro con varias especialidades. Las reglas de atención (coberturas, franjas
horarias, cupos, requisitos) son **datos editables desde la interfaz**, no código.

## Cómo correrlo

```bash
npm install
npm run db:migrate        # crea/actualiza la base (SQLite: dev.db)
npm run db:seed           # administrador + datos de ejemplo (solo desarrollo)
npm run dev -- -p 3001    # http://localhost:3001
```

Usuarios de ejemplo (solo desarrollo, salen del seed): `admin@salus.local` / `admin1234`,
`secretaria@salus.local` / `secretaria1234`, `perez@salus.local` / `perez1234`.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `npm test` | El motor de turnos (cupos, franjas, feriados, edad…) con tests unitarios |
| `npm run check:reservas` | El servicio de reservas contra la base (overrides, permisos, lista de espera…) |
| `npm run check:ui` | Un navegador real haciendo clic: paciente, secretaría, profesional y administración (necesita el servidor corriendo) |
| `npm run turnos -- perez PAMI` | Muestra la disponibilidad real de un profesional y cobertura, sin pantallas |

## Cómo está armado

- `src/lib/engine/` — **el motor**: una única función (`evaluarAgenda`) clasifica cada horario; la usan el
  turnero del paciente (`turnosDisponibles`), la agenda de la secretaría y la validación al guardar
  (`verificarTurno`), por eso nunca se contradicen. Es una función pura, sin base de datos.
- `src/lib/booking.ts` — único lugar donde se crean, cancelan y cambian de estado los turnos.
- `src/app/` — `/` turnero del paciente · `/turno/[token]` su turno · `/agenda` secretaría · `/configuracion` reglas y administración.
- `prisma/schema.prisma` — el modelo de datos (comentado).

## Reglas de negocio acordadas

- La semana va de lunes a domingo; el mes es de calendario.
- Un turno **cancelado** libera el cupo y el horario. Reservado, confirmado, **ausente** y atendido lo consumen.
- Los sobreturnos y saltos de regla de la secretaría exigen un motivo, quedan auditados y cuentan en los contadores.
- Se pueden saltear: franja, cupo completo, horario ocupado (sobreturno), anticipación mínima y plazo de reserva.
  No se pueden saltear: licencias/feriados, horarios pasados, cobertura no atendida, edad fuera de rango.
- Una regla de un profesional pisa a la de su especialidad. Un profesional sin regla para una cobertura no la atiende.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `SESSION_SECRET` | Firma las sesiones (obligatoria; larga y secreta) |
| `DATABASE_URL` | Base de datos (por defecto `file:./dev.db`) |
| `APP_URL` | Dirección pública, para los links de los mails |
| `RESEND_API_KEY`, `MAIL_FROM` | Envío de mails con Resend (sin ellas no se envía ninguno) |
| `CRON_SECRET` | Protege `POST /api/cron/notificaciones`, que envía los mails pendientes |

Los mails (confirmación, recordatorio, cancelación, lista de espera) se encolan al ocurrir el hecho y se
envían cuando un programador de tareas llama cada pocos minutos a `/api/cron/notificaciones` con
`Authorization: Bearer <CRON_SECRET>`.

## Antes de publicarlo (pendiente)

- [ ] Pasar de SQLite a **PostgreSQL** (cambiar el proveedor y el adaptador de Prisma, y volver a crear el índice
      parcial anti doble reserva que está en la migración `init`).
- [ ] No cargar los datos de ejemplo (`SEED_DEMO`) ni las contraseñas del seed; crear un administrador real.
- [ ] HTTPS, `SESSION_SECRET` y `CRON_SECRET` propios, cuenta y dominio verificado en Resend.
- [ ] El límite de pedidos de los formularios públicos (`src/lib/rate-limit.ts`) vive en memoria: con más de un
      servidor hay que pasarlo a un almacén compartido.
- [ ] Copias de seguridad de la base.
- [ ] Datos de salud: revisar con el centro las obligaciones de la Ley 25.326 de protección de datos personales
      (consentimiento, registro de la base, política de privacidad).
