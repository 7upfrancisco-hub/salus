# Salus — turnero del centro de salud

Sistema de turnos para un centro con varias especialidades. Las reglas de atención (coberturas, franjas
horarias, cupos, requisitos) son **datos editables desde la interfaz**, no código.

## Cómo correrlo

Necesita una base **PostgreSQL** (por ejemplo una gratuita de [Neon](https://neon.tech)). Copiá su cadena de
conexión en `.env.local` como `DATABASE_URL=postgresql://...` junto con `SESSION_SECRET` y los `SEED_*`.

```bash
npm install
npm run db:migrate        # crea/actualiza las tablas
npm run db:seed           # administrador + datos de ejemplo (solo desarrollo)
npm run dev -- -p 3001    # http://localhost:3001
```

Usuarios de ejemplo (**solo desarrollo**: las contraseñas están en el código público del seed, nunca usarlos con
datos reales; ver `SEED_DEMO` más abajo). Salen del seed: `admin@salus.local` / `admin1234`,
`secretaria@salus.local` / `secretaria1234`, `perez@salus.local` / `perez1234`.

## Pruebas

| Comando | Qué prueba |
|---|---|
| `npm test` | El motor de turnos (cupos, franjas, feriados, edad…) con tests unitarios |
| `npm run check:reservas` | El servicio de reservas contra la base (overrides, permisos, lista de espera…) |
| `npm run check:ui` | Un navegador real haciendo clic: paciente, secretaría, profesional y administración (necesita el servidor corriendo) |
| `npx tsx scripts/limpiar-demo.mts` | Borra los datos de demostración de la base de `DATABASE_URL` (simulacro; con `--confirmar` borra de verdad) |
| `npm run turnos -- perez PAMI` | Muestra la disponibilidad real de un profesional y cobertura, sin pantallas |

## Cómo está armado

- `src/lib/engine/` — **el motor**: una única función (`evaluarAgenda`) clasifica cada horario; la usan el
  turnero del paciente (`turnosDisponibles`), la agenda de la secretaría y la validación al guardar
  (`verificarTurno`), por eso nunca se contradicen. Es una función pura, sin base de datos.
- `src/lib/booking.ts` — único lugar donde se crean, cancelan y cambian de estado los turnos.
- `src/app/` — `/` turnero del paciente · `/turno/[token]` su turno · `/agenda` secretaría · `/configuracion` reglas y administración.
- `prisma/schema.prisma` — el modelo de datos (comentado).

## Turnos personales y preocupacionales

Lo primero que ve el paciente es `¿Qué tipo de turno necesitás?`:

- **Personal**: cobertura → especialidad → médico → **Buscar turno** → día y horario → datos.
- **Preocupacional**: estudio (3 opciones, editables) → día y horario → datos, con la **empresa** que solicita el estudio y sin obra social.

Cómo se configura el preocupacional (todo desde la interfaz):

1. **Configuración → Estudios preocupacionales**: nombre, descripción corta e indicaciones (qué traer, una por línea) de cada estudio. Se desactivan, no se borran. Todos los estudios comparten la misma agenda.
2. **Configuración → Reglas por cobertura**: a cada profesional que atienda preocupacionales se le crea una regla con la cobertura **«Preocupacional»** (franjas horarias, cupos y requisitos), igual que con una obra social.
3. La cobertura «Preocupacional» la crea una migración y no se puede renombrar; no aparece entre las coberturas del camino personal. Mientras no haya un estudio activo y un profesional con regla, el turnero avisa que no hay turnos preocupacionales online.

Secretaría también puede dar turnos preocupacionales desde la agenda (elige estudio y empresa).

## Descargar la agenda del día

En **Agenda del día** hay dos botones: *Descargar agenda del día (PDF)* (el médico elegido, con todas sus coberturas) y *Descargar preocupacionales del día (PDF)* (solo los profesionales que el usuario puede ver). Los turnos cancelados no figuran. Como el archivo trae datos de salud, cada descarga queda en el registro de actividad (`AGENDA_DOWNLOADED`) y solo la puede bajar el personal con acceso a esa agenda.

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
| `DATABASE_URL` | Cadena de conexión a PostgreSQL (obligatoria; en Neon, la «pooled») |
| `DIRECT_URL` | Conexión directa, solo para migraciones. Opcional: también se acepta `DATABASE_URL_UNPOOLED` (la inyecta Neon) |
| `APP_URL` | Dirección pública, para los links de los mails |
| `RESEND_API_KEY`, `MAIL_FROM` | Envío de mails con Resend (sin ellas no se envía ninguno) |
| `CRON_SECRET` | Protege `/api/cron/notificaciones` (GET o POST), que envía los mails pendientes |

Los mails (confirmación, recordatorio, cancelación, lista de espera) se encolan al ocurrir el hecho y se
envían cuando un programador de tareas llama cada pocos minutos a `/api/cron/notificaciones` con
`Authorization: Bearer <CRON_SECRET>`. Mientras no estén `RESEND_API_KEY` y `MAIL_FROM`, los mails quedan
en la cola y salen cuando se cargan (no se pierden).

### Programar el envío de mails

El plan gratuito de Vercel solo permite un cron por día, así que hay dos programadores:

- **GitHub Actions** (`.github/workflows/notificaciones.yml`): llama al endpoint cada 5 minutos. Hay que cargar
  en el repo dos secretos (*Settings → Secrets and variables → Actions*): `APP_URL` y `CRON_SECRET` (el mismo
  valor que en Vercel). GitHub desactiva los workflows programados de un repo sin actividad en 60 días: si pasa,
  se reactiva desde la pestaña *Actions*. Para probarlo a mano: *Actions → Enviar mails pendientes → Run workflow*.
- **Vercel Cron** (`vercel.json`): una llamada diaria de respaldo. Vercel agrega solo el `Authorization` si
  `CRON_SECRET` está definido en el proyecto.

## Antes de publicarlo (pendiente)

- [x] PostgreSQL (hecho): el índice anti doble reserva está en la migración `init` y `bookAppointment` serializa
      las reservas con un candado de la base (`pg_advisory_xact_lock`).
- [ ] No cargar los datos de ejemplo (`SEED_DEMO`) ni las contraseñas del seed; crear un administrador real.
- [ ] HTTPS, `SESSION_SECRET` y `CRON_SECRET` propios, cuenta y dominio verificado en Resend.
- [x] El límite de pedidos y el freno del login (`src/lib/rate-limit.ts`) se cuentan en la base (tabla
      `RateLimitHit`), así que valen con varias instancias. La IP sale de `x-vercel-forwarded-for` en Vercel.
- [ ] Copias de seguridad de la base.
- [ ] Datos de salud: revisar con el centro las obligaciones de la Ley 25.326 de protección de datos personales
      (consentimiento, registro de la base, política de privacidad).

## Deploy (Vercel + Neon)

1. Subir el repo a GitHub e importarlo en Vercel (framework: Next.js; el script `vercel-build` genera el cliente
   de Prisma y aplica las migraciones solo).
2. En Vercel → *Storage* → crear una base **Neon** y conectarla al proyecto: inyecta `DATABASE_URL` y
   `DATABASE_URL_UNPOOLED`.
3. Variables del proyecto: `SESSION_SECRET` (≥ 32 caracteres, propio), `CRON_SECRET`, `APP_URL` (la URL pública) y,
   si se quieren mails, `RESEND_API_KEY` y `MAIL_FROM`.
4. Primera carga de datos (una sola vez, desde esta PC con las variables de la base de producción):
   `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… SEED_DEMO=1 npm run db:seed` — `SEED_DEMO=1` solo para una demo.
