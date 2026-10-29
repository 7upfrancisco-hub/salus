-- El centro decidió no ofrecer turnos preocupacionales: el sistema es solo para atención en la clínica
-- (con obra social o particular). Se borra todo lo que dejó la migración 20261023000000_preocupacional.

-- Los turnos de la cobertura «Preocupacional» (sus mails encolados caen por cascada), la lista de espera
-- y las reglas (con sus franjas, cupos y requisitos, también por cascada). Los pacientes se conservan.
DELETE FROM "Appointment" WHERE "coverageId" IN (SELECT "id" FROM "Coverage" WHERE "isOccupational");
DELETE FROM "WaitlistEntry" WHERE "coverageId" IN (SELECT "id" FROM "Coverage" WHERE "isOccupational");
DELETE FROM "Coverage" WHERE "isOccupational";

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_studyId_fkey";

-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "studyId",
DROP COLUMN "company";

-- AlterTable
ALTER TABLE "Coverage" DROP COLUMN "isOccupational";

-- DropTable
DROP TABLE "OccupationalStudy";
