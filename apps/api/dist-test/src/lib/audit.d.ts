import type { PrismaClient } from '@nexpanel/database';
/** Recursively redact secret-looking fields so they never reach the audit log. */
export declare function redactSecrets(value: unknown, depth?: number): unknown;
export interface AuditEntry {
    actor: 'user' | 'ai' | 'system' | 'node';
    userId?: string | null;
    conversationId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    args?: unknown;
    success: boolean;
    error?: string;
    ip?: string;
}
export declare function writeAudit(db: PrismaClient, entry: AuditEntry): Promise<void>;
//# sourceMappingURL=audit.d.ts.map