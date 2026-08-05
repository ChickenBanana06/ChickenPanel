import { z } from 'zod';
import type { Application } from '@nexpanel/database';
import type { FileEntry } from '@nexpanel/shared';
import {
  MinecraftConfigSchema,
  buildMinecraftProvisioning,
  buildStartCommand,
  getMinecraftCatalog,
} from '@nexpanel/ext-minecraft';
import type { ApplicationExtension } from '../services/extension-registry.js';

/** Resolve a Modrinth plugin project+game version to a downloadable jar. */
async function resolveModrinthPlugin(
  projectSlug: string,
  gameVersion: string,
): Promise<{ url: string; filename: string }> {
  const res = await fetch(
    `https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}/version?loaders=${encodeURIComponent(
      '["paper","spigot","bukkit"]',
    )}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`,
    { headers: { 'user-agent': 'nexpanel/0.1' } },
  );
  if (!res.ok) throw new Error(`Modrinth lookup failed (${res.status}) for ${projectSlug}`);
  const versions = (await res.json()) as { files: { url: string; filename: string; primary: boolean }[] }[];
  const first = versions[0];
  if (!first) throw new Error(`No compatible version of ${projectSlug} for Minecraft ${gameVersion}`);
  const file = first.files.find((f) => f.primary) ?? first.files[0];
  if (!file) throw new Error('Version has no files');
  return { url: file.url, filename: file.filename };
}

export const minecraftExtension: ApplicationExtension = {
  type: 'minecraft',
  displayName: 'Minecraft server',
  description: 'Vanilla or Paper Minecraft server with console, backups and plugin management.',
  configSchema: MinecraftConfigSchema,
  getCatalog: getMinecraftCatalog,

  async buildCreation(input, ctx) {
    const cfg = MinecraftConfigSchema.parse(input.config);
    const [port] = await ctx.allocatePorts(input.nodeId, 1, cfg.preferredPort ? [cfg.preferredPort] : []);
    if (!port) throw new Error('Port allocation failed');
    const env = { ...input.env };
    const platform = (input.node.platform ?? 'linux') as 'win32' | 'linux' | 'darwin';
    const caps = (input.node.capabilities ?? {}) as { java?: string | null };
    const plan = await buildMinecraftProvisioning(input.name, cfg, port, env, input.restartPolicy, {
      platform,
      hasJava: Boolean(caps.java),
    });
    return {
      spec: { appId: 'pending', ...plan.spec },
      steps: plan.steps,
      ports: [port],
      config: { ...plan.effectiveConfig, port },
      env,
    };
  },

  buildRuntimeSpec(app: Application) {
    const cfg = MinecraftConfigSchema.parse(app.config);
    const proxy = cfg.isProxy;
    return {
      appId: app.id,
      name: app.name,
      type: 'minecraft',
      startCommand: buildStartCommand(cfg),
      stopMethod: proxy ? { type: 'stdin', command: 'end' } : { type: 'stdin', command: 'stop' },
      stopGraceSeconds: 60,
      env: (app.env as Record<string, string>) ?? {},
      restartPolicy: app.restartPolicy as never,
      limits: { cpuPercent: null, memoryMb: cfg.memoryMb + 1024, diskMb: null },
      ports: app.ports,
    };
  },

  async onBeforeStart(app, helpers) {
    const cfg = MinecraftConfigSchema.parse(app.config);
    if (cfg.isProxy) return; // Proxies don't have server.properties
    const primaryPort = app.ports[0];
    if (primaryPort === undefined) return;

    let content = '';
    try {
      const fileRes = await helpers.command<{ content: string }>({
        op: 'fs.read',
        appId: app.id,
        path: 'server.properties',
      });
      content = fileRes.content;
    } catch {
      // Use buildServerProperties if file doesn't exist
    }

    if (content) {
      const lines = content.split('\n');
      let hasServerPort = false;
      let hasQueryPort = false;
      const updatedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('server-port=')) {
          hasServerPort = true;
          return `server-port=${primaryPort}`;
        }
        if (trimmed.startsWith('query.port=')) {
          hasQueryPort = true;
          return `query.port=${primaryPort}`;
        }
        return line;
      });
      if (!hasServerPort) updatedLines.push(`server-port=${primaryPort}`);
      if (!hasQueryPort) updatedLines.push(`query.port=${primaryPort}`);
      content = updatedLines.join('\n');
    } else {
      const { buildServerProperties } = await import('@nexpanel/ext-minecraft');
      content = buildServerProperties(cfg, primaryPort, app.name);
    }

    await helpers.command({
      op: 'fs.write',
      appId: app.id,
      path: 'server.properties',
      content,
    });
  },

  actions: [
    {
      id: 'install_plugin',
      displayName: 'Install plugin',
      permission: 'files.write',
      argsSchema: z.object({
        source: z.enum(['modrinth', 'url']).default('modrinth'),
        project: z.string().max(100).optional().describe('Modrinth project slug, e.g. "essentialsx"'),
        url: z.string().url().optional().describe('Direct download URL of a plugin jar'),
        filename: z.string().max(200).optional(),
      }),
      async run(app, args, helpers) {
        const a = args as { source: string; project?: string; url?: string; filename?: string };
        const cfg = MinecraftConfigSchema.parse(app.config);
        if (cfg.software === 'vanilla') throw new Error('Vanilla servers do not support plugins — use Paper');
        let url: string;
        let filename: string;
        if (a.source === 'modrinth') {
          if (!a.project) throw new Error('project (Modrinth slug) is required');
          const resolved = await resolveModrinthPlugin(a.project, cfg.version);
          url = resolved.url;
          filename = a.filename ?? resolved.filename;
        } else {
          if (!a.url) throw new Error('url is required');
          url = a.url;
          filename = a.filename ?? new URL(a.url).pathname.split('/').pop() ?? 'plugin.jar';
        }
        if (!/^[\w.-]+\.jar$/i.test(filename)) throw new Error(`Refusing suspicious plugin filename: ${filename}`);
        await helpers.command({ op: 'fs.download', appId: app.id, url, dest: `plugins/${filename}` }, { timeoutMs: 300000 });
        return { installed: filename, note: 'Restart the server to load the plugin.' };
      },
    },
    {
      id: 'remove_plugin',
      displayName: 'Remove plugin',
      permission: 'files.write',
      argsSchema: z.object({ filename: z.string().regex(/^[\w.-]+\.jar$/i) }),
      async run(app, args, helpers) {
        const a = args as { filename: string };
        await helpers.command({ op: 'fs.delete', appId: app.id, path: `plugins/${a.filename}` });
        return { removed: a.filename, note: 'Restart the server to unload the plugin.' };
      },
    },
    {
      id: 'list_plugins',
      displayName: 'List plugins',
      permission: 'files.read',
      argsSchema: z.object({}),
      async run(app, _args, helpers) {
        const res = await helpers.command<{ entries: FileEntry[] }>({ op: 'fs.list', appId: app.id, path: 'plugins' });
        return { plugins: res.entries.filter((e) => e.type === 'file' && e.name.endsWith('.jar')).map((e) => e.name) };
      },
    },
  ],
};
