import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export const DEFAULT_DEV_DATABASE_URL = 'postgresql://nexpanel:nexpanel@127.0.0.1:5490/nexpanel';

let client: PrismaClient | null = null;

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DEV_DATABASE_URL;
}

/** Singleton Prisma client. Call disconnectDb() on shutdown. */
export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: getDatabaseUrl() } },
      log: process.env.NEXPANEL_SQL_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
