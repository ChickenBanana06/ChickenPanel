import type { PrismaClient } from '@nexpanel/database';
import type { NodeManager } from './node-manager.js';
import { ApiError } from '../lib/errors.js';

const RANGE_START = 25000;
const RANGE_END = 35000;

/**
 * Allocates ports on a node. Considers ports already assigned to applications
 * in the database and asks the live agent to verify the ports are actually
 * free on the host before handing them out. Never assumes a specific port
 * (e.g. 25565) is available.
 */
export class PortAllocator {
  constructor(
    private readonly db: PrismaClient,
    private readonly nodes: NodeManager,
  ) {}

  async allocate(nodeId: string, count: number, preferred: number[] = []): Promise<number[]> {
    const apps = await this.db.application.findMany({
      where: { nodeId },
      select: { ports: true },
    });
    const reserved = new Set<number>(apps.flatMap((a) => a.ports));

    const candidates: number[] = [];
    for (const p of preferred) {
      if (!reserved.has(p) && candidates.length < count) candidates.push(p);
    }
    // Deterministic scan with a random offset so parallel creations spread out.
    const offset = Math.floor(Math.random() * (RANGE_END - RANGE_START));
    for (let i = 0; candidates.length < count * 4 && i < RANGE_END - RANGE_START; i++) {
      const port = RANGE_START + ((offset + i * 7) % (RANGE_END - RANGE_START));
      if (!reserved.has(port) && !candidates.includes(port)) candidates.push(port);
    }
    if (candidates.length < count) throw ApiError.conflict('No free ports available on node');

    // Verify with the live agent when connected; otherwise trust the DB view.
    if (this.nodes.isOnline(nodeId)) {
      const checked = await this.nodes.command<{ free: number[] }>(nodeId, {
        op: 'sys.ports.check',
        ports: candidates.slice(0, Math.min(candidates.length, 64)),
      });
      const free = candidates.filter((p) => checked.free.includes(p));
      if (free.length < count) throw ApiError.conflict('Not enough free ports on node');
      return free.slice(0, count);
    }
    return candidates.slice(0, count);
  }
}
