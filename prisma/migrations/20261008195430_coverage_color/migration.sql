-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Coverage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isParticular" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#0d9488'
);
INSERT INTO "new_Coverage" ("active", "id", "isParticular", "name", "sortOrder") SELECT "active", "id", "isParticular", "name", "sortOrder" FROM "Coverage";
DROP TABLE "Coverage";
ALTER TABLE "new_Coverage" RENAME TO "Coverage";
CREATE UNIQUE INDEX "Coverage_name_key" ON "Coverage"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
