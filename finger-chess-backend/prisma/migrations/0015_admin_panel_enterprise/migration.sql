-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'moderator';

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "internal_notes" TEXT;
