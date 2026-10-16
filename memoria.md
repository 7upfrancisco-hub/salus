# Memoria del proyecto — Salus

Archivo para dejar registrado el estado del proyecto y las decisiones tomadas, así se puede retomar el trabajo en cualquier sesión. Actualizarlo al terminar cada tanda de trabajo.

## Qué es

Salus: turnero de un centro de salud con varias especialidades. Las reglas de atención (coberturas, franjas horarias, cupos, requisitos) son **datos editables desde la interfaz**, no código.

## Stack

- Next.js (versión con cambios respecto a lo habitual: leer `node_modules/next/dist/docs/` antes de escribir código, ver `AGENTS.md`)
- Prisma + SQLite (`dev.db`)
- Vitest para tests unitarios

## Cómo correrlo

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev -- -p 3001    # http://localhost:3001
```

Usuarios de ejemplo (solo desarrollo): `admin@salus.local`, `secretaria@salus.local`, `perez@salus.local`.

## Pruebas

- `npm test` — motor de turnos (unitarios)
- `npm run check:reservas` — servicio de reservas contra la base
- `npm run check:ui` — navegador real (requiere el servidor corriendo)
- `npm run turnos -- perez PAMI` — disponibilidad real sin pantallas

## Arquitectura

- `src/lib/engine/` — motor puro (`evaluarAgenda`); lo usan el turnero del paciente, la agenda de la secretaría y la validación al guardar, así nunca se contradicen.
- `src/lib/booking.ts` — único lugar donde se crean, cancelan y cambian de estado los turnos.
- `src/app/` — `/` turnero del paciente · `/turno/[token]` su turno · `/agenda` secretaría · `/configuracion` reglas y administración · `/login`.
- `prisma/schema.prisma` — modelo de datos (comentado).
- También: `mail.ts` / `notify.ts` / `email-templates.ts` (notificaciones), `audit.ts` (auditoría), `rate-limit.ts`, `access.ts` / `auth.ts` / `session.ts` (acceso y sesión).

## Reglas de negocio acordadas

- La semana va de lunes a domingo; el mes es de calendario.
- Un turno **cancelado** libera el cupo y el horario. Reservado, confirmado, **ausente** y atendido lo consumen.
- Los sobreturnos y saltos de regla de la secretaría exigen un motivo, quedan auditados y cuentan en los contadores.

## Estado actual

- El repo de git no tiene ningún commit todavía (todo está sin versionar, rama `master`; la principal prevista es `main`).
- 2026-10-13: revisión completa para presentar el proyecto. Todo verde: `tsc`, `eslint`, `npm test` (57), `check:reservas` (con pruebas nuevas), `check:ui` (65 verificaciones, estable en 3 corridas seguidas) y `npm run build` de producción.
- Se verificó que cada página y acción de servidor exige sesión/rol (admin, `requireConfigUser`, `requireStaff`) y que 6 pedidos simultáneos por el mismo horario guardan un solo turno.

## Correcciones hechas el 2026-10-13

- **Login sin límite de intentos** → ahora se frena tras 6 fallos por email+IP (o 30 por IP) en 15 min; solo cuentan los fallos (`isBlocked` / `recordFailure` en `src/lib/rate-limit.ts`).
- **Login borraba el email** tras una contraseña incorrecta → ahora lo conserva.
- **Token del turno del paciente** era `cuid` (parcialmente predecible) → ahora `uuid()` (no requiere migración, solo `prisma generate`).
- **Lista de espera**: quien conseguía turno seguía figurando "esperando" y podía recibir avisos falsos → `bookAppointment` lo pasa a `BOOKED`.
- **Cancelación con condición de carrera** (doble mail/auditoría) → ahora es atómica (`updateMany` solo si sigue activo).
- `SESSION_SECRET` exige al menos 32 caracteres; la edad en la lista de espera usa la fecha de hoy del centro (no UTC); resto del nombre "TurnoYa" en `next.config.ts`.
- La prueba `check:ui` dependía de que el primer día libre fuera el lunes; ahora elige el lunes explícitamente. No cortar `check:ui` con `| head` (mata el proceso y deja turnos de prueba sin limpiar).

## Pendientes / próximos pasos

- Hacer el primer commit (todo está sin versionar).
- Antes de salir a producción real:
  - El límite de pedidos vive en memoria y confía en `x-forwarded-for`: detrás de un proxy hay que fijar cuál IP es confiable y, con varias instancias, usar Redis/Upstash.
  - La garantía contra doble reserva depende de que SQLite serializa las escrituras. Si se pasa a PostgreSQL hay que agregar una restricción única en la base (profesional + horario de inicio de turnos activos).
  - Un mail en estado `SENDING` que quede colgado por una caída del proceso nunca se reintenta.
  - El endpoint de cron solo acepta `POST` (algunos programadores usan `GET`).
  - `birthDateSchema` compara con la fecha UTC (margen de unas horas por la noche).
  - `public/` tiene los SVG de ejemplo de Next sin usar.

## Decisiones y notas

- 2026-10-13: se crea este archivo de memoria.
- Dr. Pérez no atiende los martes (dato del seed); las pruebas buscan el primer horario libre en vez de fijar el día.
