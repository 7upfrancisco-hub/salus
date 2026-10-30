-- Un profesional puede atender más de una especialidad: la columna Professional.specialtyId pasa a una
-- tabla de relación (muchos a muchos). Las especialidades que ya tenían cargadas se conservan.

-- CreateTable
CREATE TABLE "_ProfessionalToSpecialty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProfessionalToSpecialty_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ProfessionalToSpecialty_B_index" ON "_ProfessionalToSpecialty"("B");

-- AddForeignKey
ALTER TABLE "_ProfessionalToSpecialty" ADD CONSTRAINT "_ProfessionalToSpecialty_A_fkey" FOREIGN KEY ("A") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProfessionalToSpecialty" ADD CONSTRAINT "_ProfessionalToSpecialty_B_fkey" FOREIGN KEY ("B") REFERENCES "Specialty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copia la especialidad actual de cada profesional (A = Professional, B = Specialty).
INSERT INTO "_ProfessionalToSpecialty" ("A", "B") SELECT "id", "specialtyId" FROM "Professional";

-- DropForeignKey
ALTER TABLE "Professional" DROP CONSTRAINT "Professional_specialtyId_fkey";

-- DropIndex
DROP INDEX "Professional_specialtyId_idx";

-- AlterTable
ALTER TABLE "Professional" DROP COLUMN "specialtyId";
