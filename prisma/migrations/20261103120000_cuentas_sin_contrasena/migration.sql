-- Las cuentas de pacientes ingresan solo con el DNI: ya no hay contraseña.

-- AlterTable
ALTER TABLE "PatientAccount" DROP COLUMN "passwordHash";
