import type { Backup } from '@nexpanel/database';
import type { AppContext } from '../context.js';
export declare class BackupService {
    private readonly ctx;
    constructor(ctx: Omit<AppContext, 'ai' | 'apps'>);
    create(appId: string, name: string, userId?: string): Promise<{
        backup: Backup;
        taskId: string;
    }>;
    restore(backupId: string, userId?: string): Promise<{
        taskId: string;
    }>;
}
//# sourceMappingURL=backup-service.d.ts.map