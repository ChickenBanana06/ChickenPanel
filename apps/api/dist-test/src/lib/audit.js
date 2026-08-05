const SECRET_KEY_PATTERN = /(api[-_]?key|password|token|secret|authorization|credential)/i;
/** Recursively redact secret-looking fields so they never reach the audit log. */
export function redactSecrets(value, depth = 0) {
    if (depth > 6)
        return '[depth]';
    if (Array.isArray(value))
        return value.map((v) => redactSecrets(v, depth + 1));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redactSecrets(v, depth + 1);
        }
        return out;
    }
    if (typeof value === 'string' && value.length > 2000)
        return `${value.slice(0, 2000)}…[truncated]`;
    return value;
}
export async function writeAudit(db, entry) {
    try {
        await db.auditLog.create({
            data: {
                actor: entry.actor,
                userId: entry.userId ?? null,
                conversationId: entry.conversationId ?? null,
                action: entry.action,
                targetType: entry.targetType ?? null,
                targetId: entry.targetId ?? null,
                args: entry.args === undefined ? undefined : redactSecrets(entry.args),
                success: entry.success,
                error: entry.error ?? null,
                ip: entry.ip ?? null,
            },
        });
    }
    catch (err) {
        // Audit logging must never take down the request path, but we surface it.
        console.error('[audit] failed to write audit log entry:', err);
    }
}
//# sourceMappingURL=audit.js.map