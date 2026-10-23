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

## Turnos preocupacionales y agenda en PDF (2026-10-23)

Pedido del centro: al entrar, preguntar **personal o preocupacional**; personal = cobertura/médico + botón "Buscar turno" y agenda; preocupacional = 3 estudios y agenda; y poder **descargar la agenda del día** (preocupacional y por médico).

Decisiones acordadas con el usuario:
- Los 3 estudios comparten la agenda (cambia solo el estudio); se cargan/editan en Configuración → Estudios preocupacionales (tabla `OccupationalStudy`, no se borran, se desactivan). No cambian la duración del turno (la grilla es la del bloque del profesional).
- Preocupacional pide **empresa** (obligatoria) y no obra social. Se mantiene el paso de especialidad en el camino personal.
- Descarga en **PDF** (`pdf-lib`, hoja A4 apaisada): `/agenda/descargar?profesional=<id>&fecha=…` y `?tipo=preocupacional&fecha=…`.

Cómo está hecho:
- El preocupacional reutiliza el motor: es una cobertura especial (`Coverage.isOccupational`, creada por la migración `20261023000000_preocupacional`, una sola) con reglas por profesional. `Appointment` suma `studyId` y `company`. El paciente no queda con esa "cobertura habitual" (`upsertPatient` recibe `coverageId: null`).
- `bookAppointment` valida: la cobertura preocupacional exige estudio activo y empresa; las demás no los aceptan.
- Turnero (`booking-wizard.tsx`): paso 1 elige el camino; en personal ahora hay botón "Buscar turno" (antes buscaba al elegir médico). Los requisitos de la regla y las indicaciones del estudio se unen sin repetir (`mergeRequirements`).
- Descarga: `agenda-pdf.ts` (puro, testeado), `agenda-export.ts` (consultas), ruta con permisos (`canManageProfessional` / `getManageableProfessionals`) y auditoría.
- `limpiar-demo.mts` conserva la cobertura Preocupacional. El seed de demo suma a la Dra. Medina (medicina laboral, martes y jueves) y 3 estudios de ejemplo.
- Pruebas: 69 unitarias, `check:reservas` con bloque preocupacional/PDF, `check:ui` 93 verificaciones (borra los contadores de rate limit al empezar y terminar: ahora viven en la base y corridas seguidas se bloqueaban).

Pendiente de este tema: el centro tiene que cargar sus 3 estudios reales y crear las reglas «Preocupacional» de sus profesionales; sin eso el turnero muestra "no hay turnos preocupacionales online".

## Acceso del personal (2026-10-23)

- El login acepta un **usuario simple** (letras, números, `.`, `-`, `_`, 3 a 40) **o un email**; se guarda en la columna `User.email`. No distingue mayúsculas. Validación en `loginNameSchema` (`validation.ts`); Configuración → Usuarios también lo acepta al crear.
- `prisma/seed.ts` ya no crea un administrador si existe alguno (antes lo buscaba por `SEED_ADMIN_EMAIL`: si se renombraba el admin, cada deploy recreaba el viejo con la clave de arranque).
- `scripts/cambiar-usuario.mts`: cambia usuario y contraseña del administrador (o de `CURRENT_LOGIN`); los datos nuevos van por `NEW_LOGIN` / `NEW_PASSWORD`, nunca se guardan en el repo (es público). Deja `USER_LOGIN_CHANGED` en la auditoría, sin la contraseña.
- Producción: el administrador se cambia con ese script contra Neon (el nombre nuevo no se anota acá porque el repo es público).

## Reglas de negocio acordadas

- La semana va de lunes a domingo; el mes es de calendario.
- Un turno **cancelado** libera el cupo y el horario. Reservado, confirmado, **ausente** y atendido lo consumen.
- Los sobreturnos y saltos de regla de la secretaría exigen un motivo, quedan auditados y cuentan en los contadores.

## Estado actual

- Primer commit hecho el 2026-10-16 en la rama `main`.
- 2026-10-16: migración a PostgreSQL para poder deployar en Vercel (SQLite no sirve en serverless). Migración `init` nueva (las de SQLite se descartaron), índice parcial anti doble reserva portado, y `bookAppointment` toma un `pg_advisory_xact_lock` para serializar las reservas (cupos y superposiciones ya no dependen de SQLite). Verificado contra un Postgres local temporal: `tsc`, `eslint`, `npm test` (59), `check:reservas` (36) y `check:ui` (65) en verde con el build de producción. Se corrigió además un bug de `check-reservas` que dependía del día de la semana en que se corría.
- **Deployado el 2026-10-16**: https://salus-green.vercel.app (Vercel + Neon, con datos de demo). Repo: github.com/7upfrancisco-hub/salus (público); cada push a `main` redeploya solo. `vercel-build` aplica migraciones y, si hay `SEED_ADMIN_EMAIL` en Vercel, corre el seed (idempotente; `SEED_DEMO=1` carga la demo). Variables en Vercel: las de Neon, `SESSION_SECRET`, `CRON_SECRET`, `APP_URL`, `SEED_*`. La cadena de conexión de Neon no se puede leer por API (la integración la entrega cifrada): para correr algo contra producción hay que sacarla del panel de Vercel/Neon.
- **2026-10-22 — tanda "listo para producción" (sin commitear aún):**
  - Rate limit y freno de login pasados a la base (tabla `RateLimitHit`, migración `20261022000000_rate_limit`); una sola sentencia SQL por chequeo, se purga solo (2 % de las llamadas, registros de más de 24 h). `recordFailure` ya no recibe la ventana. `clientIp()` usa `x-vercel-forwarded-for` en Vercel y la ÚLTIMA IP de `x-forwarded-for` fuera de Vercel (la primera la escribe el cliente).
  - `/api/cron/notificaciones` acepta GET y POST, con comparación en tiempo constante.
  - Programadores: `.github/workflows/notificaciones.yml` (cada 5 min; requiere secretos `APP_URL` y `CRON_SECRET` en GitHub) + `vercel.json` con un cron diario de respaldo (Hobby no admite más frecuencia).
  - Bug corregido: sin `RESEND_API_KEY` el cron marcaba los mails como `SKIPPED` y se perdían; ahora la cola queda `PENDING` hasta que se configure Resend.
  - Verificado contra un Postgres temporal (embedded-postgres, fuera del repo): migración = schema, `tsc`, `eslint`, `npm test` (57), `check:reservas`, `check:ui` (incluye el freno de login) y `npm run build` en verde; endpoint de cron probado con GET/POST, sin auth y con auth mala.
- **2026-10-22 — sección 2 (robustez):**
  - Mails colgados: columna nueva `NotificationLog.claimedAt` (migración `20261022010000_notification_claimed_at`); al arrancar, `processPendingNotifications` devuelve a PENDING los SENDING de más de 10 min (o sin `claimedAt`) y informa `requeued`. Puede duplicar un mail ya enviado cuyo proceso murió antes de marcarlo: se prefiere a perderlo.
  - Aviso de `pg` ("client.query() while already executing"): no era un `Promise.all` nuestro sino el `include` de `coverageRule` dentro de la transacción (Prisma lo resuelve en paralelo). Se arregló con `relationLoadStrategy: "join"` (requiere `previewFeatures = ["relationJoins"]` en el generador) y `loadEngineContext` hace sus consultas de a una cuando recibe el cliente de una transacción.
  - `birthDateSchema` usa el "hoy" de la zona del centro (`DEFAULT_TIMEZONE` ahora vive en `constants.ts`). Con `todayInZone` no queda margen nocturno.
  - `scripts/limpiar-demo.mts`: borra los datos de demo de una base (simulacro por defecto, `--confirmar` para borrar, `--conservar-catalogos`). Toma la conexión de `DATABASE_URL` del entorno, nunca de `.env.local`. Conserva admins y configuración del centro. **Antes de correrlo contra producción hay que sacar `SEED_DEMO` de Vercel**: si no, el próximo deploy recarga la demo (el seed la carga cuando no hay profesionales).
  - Resend sin dominio propio: `onboarding@resend.dev` solo envía a la casilla del dueño de la cuenta, así que para mails a pacientes hace falta un dominio verificado (o cambiar de proveedor).
- Mails y cron: el envío real requiere `RESEND_API_KEY` + `MAIL_FROM` (dominio verificado en Resend) y los secretos de GitHub Actions.
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

- **Actualizar Next.js (seguridad)**: `npm audit` marca `next` 16.0.0–16.4.0 con avisos críticos (RCE en optimización de imágenes con SVG, DoS en Server Actions, RCE en `use cache`); el arreglo está en 16.4.3. El proyecto fija `16.4.0` exacto. Probar con la suite completa antes de subir.

- Revocar el token de Vercel que se usó para el deploy (se pegó en el chat).
- Mails a pacientes: en pausa hasta presentarle la propuesta al centro y que acepten pagar el dominio (~USD 10/año). Con el dominio: verificarlo en Resend y cargar `RESEND_API_KEY` + `MAIL_FROM` en Vercel. Mientras tanto los mails quedan en cola. Alternativa sin dominio (peor entrega): Brevo o SMTP de Gmail, requiere cambiar `mail.ts`.
- Secretos `APP_URL` y `CRON_SECRET` en GitHub (Settings → Secrets → Actions): hechos el 2026-10-22.
- Antes de salir a producción real:
  - La demo deployada tiene usuarios con contraseñas públicas (README): no usar con datos reales.
  - `public/` tiene los SVG de ejemplo de Next sin usar.

## Decisiones y notas

- 2026-10-13: se crea este archivo de memoria.
- Dr. Pérez no atiende los martes (dato del seed); las pruebas buscan el primer horario libre en vez de fijar el día.
