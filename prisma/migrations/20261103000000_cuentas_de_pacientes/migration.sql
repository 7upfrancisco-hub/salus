-- Cuentas de pacientes: para sacar turno online hay que ingresar con DNI y contraseña.

-- CreateTable
CREATE TABLE "PatientAccount" (
    "id" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "patientId" TEXT NOT NULL,

    CONSTRAINT "PatientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPatient" (
    "accountId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'CHILD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPatient_pkey" PRIMARY KEY ("accountId","patientId")
);

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "accountId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_dni_key" ON "PatientAccount"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_patientId_key" ON "PatientAccount"("patientId");

-- CreateIndex
CREATE INDEX "AccountPatient_patientId_idx" ON "AccountPatient"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_accountId_idx" ON "Appointment"("accountId");

-- AddForeignKey
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAccount" ADD CONSTRAINT "PatientAccount_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPatient" ADD CONSTRAINT "AccountPatient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PatientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPatient" ADD CONSTRAINT "AccountPatient_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
