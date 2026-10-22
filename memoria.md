# Memoria del proyecto — Salus

Archivo para dejar registrado el estado del proyecto y las decisiones tomadas, así se puede retomar el trabajo en cualquier sesión. Actualizarlo al terminar cada tanda de trabajo.

## Qué es

Salus: turnero de un centro de salud con varias especialidades. Las reglas de atención (coberturas, franjas horarias, cupos, requisitos) son **datos editables desde la interfaz**, no código.

## Stack

- Next.js (versión con cambios respecto a lo habitual: leer `node_modules/next/dist/docs/` antes de escribir código, ver `AGENTS.md`)
- Prisma + PostgreSQL (adaptador `@prisma/adapter-pg`; desde 2026-10-16, antes SQLite). Necesita `DATABASE_URL` en `.env.local`.
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

- Primer commit hecho el 2026-10-16 en la rama `main`.
- 2026-10-16: migración a PostgreSQL para poder deployar en Vercel (SQLite no sirve en serverless). Migración `init` nueva (las de SQLite se descartaron), índice parcial anti doble reserva portado, y `bookAppointment` toma un `pg_advisory_xact_lock` para serializar las reservas (cupos y superposiciones ya no dependen de SQLite). Verificado contra un Postgres local temporal: `tsc`, `eslint`, `npm test` (57), `check:reservas` (36) y `check:ui` (65) en verde con el build de producción. Se corrigió además un bug de `check-reservas` que dependía del día de la semana en que se corría.
- **Deployado el 2026-10-16**: https://salus-green.vercel.app (Vercel + Neon, con datos de demo). Repo: github.com/7upfrancisco-hub/salus (público); cada push a `main` redeploya solo. `vercel-build` aplica migraciones y, si hay `SEED_ADMIN_EMAIL` en Vercel, corre el seed (idempotente; `SEED_DEMO=1` carga la demo). Variables en Vercel: las de Neon, `SESSION_SECRET`, `CRON_SECRET`, `APP_URL`, `SEED_*`. La cadena de conexión de Neon no se puede leer por API (la integración la entrega cifrada): para correr algo contra producción hay que sacarla del panel de Vercel/Neon.
- **2026-10-22 — tanda "listo para producción" (sin commitear aún):**
  - Rate limit y freno de login pasados a la base (tabla `RateLimitHit`, migración `20261022000000_rate_limit`); una sola sentencia SQL por chequeo, se purga solo (2 % de las llamadas, registros de más de 24 h). `recordFailure` ya no recibe la ventana. `clientIp()` usa `x-vercel-forwarded-for` en Vercel y la ÚLTIMA IP de `x-forwarded-for` fuera de Vercel (la primera la escribe el cliente).
  - `/api/cron/notificaciones` acepta GET y POST, con comparación en tiempo constante.
  - Programadores: `.github/workflows/notificaciones.yml` (cada 5 min; requiere secretos `APP_URL` y `CRON_SECRET` en GitHub) + `vercel.json` con un cron diario de respaldo (Hobby no admite más frecuencia).
  - Bug corregido: sin `RESEND_API_KEY` el cron marcaba los mails como `SKIPPED` y se perdían; ahora la cola queda `PENDING` hasta que se configure Resend.
  - Verificado contra un Postgres temporal (embedded-postgres, fuera del repo): migración = schema, `tsc`, `eslint`, `npm test` (57), `check:reservas`, `check:ui` (incluye el freno de login) y `npm run build` en verde; endpoint de cron probado con GET/POST, sin auth y con auth mala.
- Mails y cron: el envío real requiere `RESEND_API_KEY` + `MAIL_FROM` (dominio verificado en Resend) y los secretos de GitHub Actions.
- Aviso de `pg` en las pruebas ("client.query() while already executing"): viene de consultas en paralelo dentro de una transacción (`Promise.all` con el cliente `tx`); hoy anda, pero dejaría de andar con `pg@9`.
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

- Revocar el token de Vercel que se usó para el deploy (se pegó en el chat).
- Cargar los secretos `APP_URL` y `CRON_SECRET` en GitHub (Settings → Secrets → Actions), y `RESEND_API_KEY` + `MAIL_FROM` en Vercel, para que salgan los avisos.
- Antes de salir a producción real:
  - La demo deployada tiene usuarios con contraseñas públicas (README): no usar con datos reales.
  - Un mail en estado `SENDING` que quede colgado por una caída del proceso nunca se reintenta.
  - `birthDateSchema` compara con la fecha UTC (margen de unas horas por la noche).
  - `public/` tiene los SVG de ejemplo de Next sin usar.

## Decisiones y notas

- 2026-10-13: se crea este archivo de memoria.
- Dr. Pérez no atiende los martes (dato del seed); las pruebas buscan el primer horario libre en vez de fijar el día.
