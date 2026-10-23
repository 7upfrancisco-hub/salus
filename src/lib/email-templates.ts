/** Textos de los mails. Solo incluyen lo necesario: no se detallan motivos de consulta ni datos clínicos. */

type Base = { centerName: string; manageUrl: string };

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function formatWhen(startsAt: Date, timezone: string) {
  const text = new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(startsAt);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function layout(centerName: string, title: string, bodyHtml: string, buttonLabel: string | null, url: string) {
  const button = buttonLabel
    ? `<p style="margin:24px 0"><a href="${escape(url)}" style="background:#0d9488;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escape(buttonLabel)}</a></p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#111">
<h2 style="color:#0d9488;margin-bottom:4px">${escape(centerName)}</h2>
<h3 style="margin-top:0">${escape(title)}</h3>
${bodyHtml}
${button}
<p style="color:#666;font-size:12px">Este es un aviso automático. Si no pediste este turno, ignorá este mensaje.</p>
</div>`;
}

type AppointmentMail = Base & {
  patientName: string;
  professionalName: string;
  when: string;
  /** Solo en turnos preocupacionales. */
  studyName?: string;
  requirements: string[];
};

function appointmentBody(data: AppointmentMail, intro: string) {
  const reqs = data.requirements.length
    ? `<p><strong>Acordate de traer:</strong></p><ul>${data.requirements.map((r) => `<li>${escape(r)}</li>`).join("")}</ul>`
    : "";
  return `<p>Hola ${escape(data.patientName)}, ${escape(intro)}</p>
<p><strong>${escape(data.when)} hs</strong><br>${escape(data.professionalName)}${data.studyName ? `<br>Estudio: ${escape(data.studyName)}` : ""}</p>${reqs}`;
}

const studyText = (data: AppointmentMail) => (data.studyName ? ` Estudio: ${data.studyName}.` : "");

const reqsText = (reqs: string[]) => (reqs.length ? `\nAcordate de traer:\n${reqs.map((r) => `- ${r}`).join("\n")}\n` : "");

export function confirmationEmail(data: AppointmentMail) {
  return {
    subject: `Turno reservado · ${data.when}`,
    html: layout(data.centerName, "Tu turno está reservado", appointmentBody(data, "reservaste este turno:"), "Ver, confirmar o cancelar mi turno", data.manageUrl),
    text: `Hola ${data.patientName}, reservaste un turno en ${data.centerName}:\n${data.when} hs con ${data.professionalName}.${studyText(data)}${reqsText(data.requirements)}\nVer, confirmar o cancelar: ${data.manageUrl}`,
  };
}

export function reminderEmail(data: AppointmentMail) {
  return {
    subject: `Recordatorio de turno · ${data.when}`,
    html: layout(data.centerName, "Te recordamos tu turno", appointmentBody(data, "te recordamos tu turno:"), "Confirmar o cancelar mi turno", data.manageUrl),
    text: `Hola ${data.patientName}, te recordamos tu turno en ${data.centerName}:\n${data.when} hs con ${data.professionalName}.${studyText(data)}${reqsText(data.requirements)}\nConfirmar o cancelar: ${data.manageUrl}`,
  };
}

export function cancellationEmail(data: AppointmentMail) {
  return {
    subject: "Tu turno fue cancelado",
    html: layout(data.centerName, "Turno cancelado", `<p>Hola ${escape(data.patientName)}, se canceló tu turno del <strong>${escape(data.when)} hs</strong> con ${escape(data.professionalName)}.</p><p>Podés sacar uno nuevo cuando quieras.</p>`, "Sacar un turno nuevo", data.manageUrl),
    text: `Hola ${data.patientName}, se canceló tu turno del ${data.when} hs con ${data.professionalName}. Podés sacar uno nuevo: ${data.manageUrl}`,
  };
}

export function waitlistEmail(data: Base & { patientName: string; specialtyName: string }) {
  return {
    subject: "Se liberó un turno",
    html: layout(data.centerName, "Se liberó un turno", `<p>Hola ${escape(data.patientName)}, se liberó un turno de ${escape(data.specialtyName)} y estabas en lista de espera.</p><p>Los turnos se toman por orden de llegada: entrá cuanto antes.</p>`, "Sacar mi turno", data.manageUrl),
    text: `Hola ${data.patientName}, se liberó un turno de ${data.specialtyName} y estabas en lista de espera. Sacá tu turno: ${data.manageUrl}`,
  };
}
