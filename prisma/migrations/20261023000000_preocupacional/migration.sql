-- AlterTable
ALTER TABLE "Coverage" ADD COLUMN "isOccupational" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "studyId" TEXT,
ADD COLUMN "company" TEXT;

-- CreateTable
CREATE TABLE "OccupationalStudy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OccupationalStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OccupationalStudy_name_key" ON "OccupationalStudy"("name");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "OccupationalStudy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La cobertura "Preocupacional" existe siempre (una sola). Si ya había una con ese nombre, se la marca.
INSERT INTO "Coverage" ("id", "name", "isParticular", "active", "sortOrder", "color", "isOccupational")
SELECT gen_random_uuid()::text, 'Preocupacional', false, true, 99, '#7c3aed', true
WHERE NOT EXISTS (SELECT 1 FROM "Coverage" WHERE "name" = 'Preocupacional');

UPDATE "Coverage" SET "isOccupational" = true WHERE "name" = 'Preocupacional';
