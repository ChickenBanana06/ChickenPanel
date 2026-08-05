import type { PrismaClient } from '@nexpanel/database';
import type { NodeManager } from './node-manager.js';
/**
 * Allocates ports on a node. Considers ports already assigned to applications
 * in the database and asks the live agent to verify the ports are actually
 * free on the host before handing them out. Never assumes a specific port
 * (e.g. 25565) is available.
 */
export declare class PortAllocator {
    private readonly db;
    private readonly nodes;
    constructor(db: PrismaClient, nodes: NodeManager);
    allocate(nodeId: string, count: number, preferred?: number[]): Promise<number[]>;
}
//# sourceMappingURL=port-allocator.d.ts.map