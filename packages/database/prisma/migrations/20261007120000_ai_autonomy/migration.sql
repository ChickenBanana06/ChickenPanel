-- AlterTable
ALTER TABLE "AIConversation" ADD COLUMN IF NOT EXISTS "autonomyLevel" TEXT NOT NULL DEFAULT 'moderate';
