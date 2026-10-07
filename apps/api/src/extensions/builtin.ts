import { z } from 'zod';
import type { Application } from '@nexpanel/database';
import type { AppRuntimeSpec, ProvisionStep } from '@nexpanel/shared';
import type { ApplicationExtension, CreationInput, ExtensionContext } from '../services/extension-registry.js';

/** Split a command line into argv, honoring double and single quotes. */
export function parseCommandLine(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        out.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

const GIT_URL = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'Only https git URLs are allowed')
  .refine((u) => {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return false;
      }
      if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(host)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, 'Git URL must not point to loopback, private, or internal hosts')
  .optional();

function baseSpec(input: CreationInput, partial: Partial<AppRuntimeSpec>): AppRuntimeSpec {
  return {
    appId: 'pending', // replaced by AppService once the row exists
    name: input.name,
    type: 'custom',
    startCommand: ['echo', 'not configured'],
    stopMethod: { type: 'signal', signal: 'SIGTERM' },
    stopGraceSeconds: 30,
    env: input.env,
    restartPolicy: input.restartPolicy,
    limits: {
      cpuPercent: input.limits.cpuPercent ?? null,
      memoryMb: input.limits.memoryMb ?? null,
      diskMb: input.limits.diskMb ?? null,
    },
    ports: [],
    ...partial,
  };
}

function gitSteps(gitUrl: string | undefined): ProvisionStep[] {
  if (!gitUrl) return [];
  return [
    { op: 'exec', command: ['git', 'clone', '--depth', '1', gitUrl, '.'], cwd: '.', timeoutMs: 600000 },
  ];
}

/* ------------------------------------------------------------------ */

const CustomConfig = z.object({
  startCommand: z.string().min(1).max(2000),
  gitUrl: GIT_URL,
  installCommand: z.string().max(2000).optional(),
  autoStart: z.boolean().default(false),
});

export const customExtension: ApplicationExtension = {
  type: 'custom',
  displayName: 'Custom application',
  description: 'Run any command as a managed application.',
  configSchema: CustomConfig,
  async buildCreation(input, ctx) {
    const cfg = CustomConfig.parse(input.config);
    const ports = await ctx.allocatePorts(input.nodeId, 1);
    const steps: ProvisionStep[] = [
      ...gitSteps(cfg.gitUrl),
      ...(cfg.installCommand
        ? [{ op: 'exec' as const, command: parseCommandLine(cfg.installCommand), cwd: '.', timeoutMs: 900000 }]
        : []),
    ];
    return {
      spec: baseSpec(input, {
        type: 'custom',
        startCommand: parseCommandLine(cfg.startCommand),
        ports,
        env: { ...input.env, PORT: String(ports[0]) },
      }),
      steps,
      ports,
      config: cfg,
      env: { ...input.env, PORT: String(ports[0]) },
    };
  },
  buildRuntimeSpec(app: Application) {
    const cfg = CustomConfig.parse(app.config);
    return {
      appId: app.id,
      name: app.name,
      type: app.type,
      startCommand: parseCommandLine(cfg.startCommand),
      stopMethod: { type: 'signal', signal: 'SIGTERM' },
      stopGraceSeconds: 30,
      env: (app.env as Record<string, string>) ?? {},
      restartPolicy: app.restartPolicy as never,
      limits: (app.limits as never) ?? { cpuPercent: null, memoryMb: null, diskMb: null },
      ports: app.ports,
    };
  },
};

/* ------------------------------------------------------------------ */

const NodeAppConfig = z.object({
  gitUrl: GIT_URL,
  installCommand: z.string().max(2000).default('npm install'),
  startCommand: z.string().min(1).max(2000).default('npm start'),
  autoStart: z.boolean().default(false),
});

function makeNodeLikeExtension(opts: {
  type: string;
  displayName: string;
  description: string;
  defaultStart: string;
  defaultInstall: string;
  envExtras?: (ports: number[]) => Record<string, string>;
}): ApplicationExtension {
  const ConfigSchema = NodeAppConfig.extend({
    installCommand: z.string().max(2000).default(opts.defaultInstall),
    startCommand: z.string().min(1).max(2000).default(opts.defaultStart),
  });
  return {
    type: opts.type,
    displayName: opts.displayName,
    description: opts.description,
    configSchema: ConfigSchema,
    async buildCreation(input: CreationInput, ctx: ExtensionContext) {
      const cfg = ConfigSchema.parse(input.config);
      const ports = await ctx.allocatePorts(input.nodeId, 1);
      const env = { ...input.env, PORT: String(ports[0]), ...(opts.envExtras?.(ports) ?? {}) };
      const steps: ProvisionStep[] = [
        ...gitSteps(cfg.gitUrl),
        ...(cfg.gitUrl && cfg.installCommand
          ? [{ op: 'exec' as const, command: parseCommandLine(cfg.installCommand), cwd: '.', timeoutMs: 900000 }]
          : []),
      ];
      return {
        spec: baseSpec(input, { type: opts.type, startCommand: parseCommandLine(cfg.startCommand), ports, env }),
        steps,
        ports,
        config: cfg,
        env,
      };
    },
    buildRuntimeSpec(app: Application) {
      const cfg = ConfigSchema.parse(app.config);
      return {
        appId: app.id,
        name: app.name,
        type: app.type,
        startCommand: parseCommandLine(cfg.startCommand),
        stopMethod: { type: 'signal', signal: 'SIGTERM' },
        stopGraceSeconds: 30,
        env: (app.env as Record<string, string>) ?? {},
        restartPolicy: app.restartPolicy as never,
        limits: (app.limits as never) ?? { cpuPercent: null, memoryMb: null, diskMb: null },
        ports: app.ports,
      };
    },
  };
}

export const nodeExtension = makeNodeLikeExtension({
  type: 'node',
  displayName: 'Node.js application',
  description: 'Host a Node.js application from a git repository or uploaded files.',
  defaultInstall: 'npm install',
  defaultStart: 'npm start',
});

export const pythonExtension = makeNodeLikeExtension({
  type: 'python',
  displayName: 'Python application',
  description: 'Host a Python application (pip requirements supported).',
  defaultInstall: 'pip install -r requirements.txt',
  defaultStart: 'python main.py',
});

export const discordBotExtension = makeNodeLikeExtension({
  type: 'discord-bot',
  displayName: 'Discord bot',
  description: 'Host a Node.js or Python Discord bot. Set DISCORD_TOKEN in environment variables.',
  defaultInstall: 'npm install',
  defaultStart: 'npm start',
});

/* ------------------------------------------------------------------ */

const STATIC_SERVER_SOURCE = `// ChickenPanel static site server (generated)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'public');
const port = Number(process.env.PORT ?? 8080);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    let s = await stat(p).catch(() => null);
    if (s?.isDirectory()) { p = join(p, 'index.html'); s = await stat(p).catch(() => null); }
    if (!s) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(500); res.end('error'); }
}).listen(port, () => console.log('static site listening on ' + port));
`;

const StaticSiteConfig = z.object({
  gitUrl: GIT_URL,
  autoStart: z.boolean().default(true),
});

export const websiteExtension: ApplicationExtension = {
  type: 'website',
  displayName: 'Static website',
  description: 'Host a static website. Files in the public/ directory are served over HTTP.',
  configSchema: StaticSiteConfig,
  async buildCreation(input, ctx) {
    const cfg = StaticSiteConfig.parse(input.config);
    const ports = await ctx.allocatePorts(input.nodeId, 1);
    const env = { ...input.env, PORT: String(ports[0]) };
    const steps: ProvisionStep[] = [
      ...gitSteps(cfg.gitUrl),
      { op: 'write', path: 'server.mjs', content: STATIC_SERVER_SOURCE, base64: false },
      { op: 'mkdir', path: 'public' },
      ...(cfg.gitUrl
        ? []
        : [
            {
              op: 'write' as const,
              path: 'public/index.html',
              content:
                '<!doctype html><html><head><meta charset="utf-8"><title>New site</title></head>' +
                '<body style="font-family:system-ui;background:#0b0e14;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0">' +
                '<div><h1>🚀 Your site is live</h1><p>Replace public/index.html to get started.</p></div></body></html>',
              base64: false,
            },
          ]),
    ];
    return {
      spec: baseSpec(input, { type: 'website', startCommand: ['node', 'server.mjs'], ports, env }),
      steps,
      ports,
      config: cfg,
      env,
    };
  },
  buildRuntimeSpec(app: Application) {
    return {
      appId: app.id,
      name: app.name,
      type: app.type,
      startCommand: ['node', 'server.mjs'],
      stopMethod: { type: 'signal', signal: 'SIGTERM' },
      stopGraceSeconds: 15,
      env: (app.env as Record<string, string>) ?? {},
      restartPolicy: app.restartPolicy as never,
      limits: (app.limits as never) ?? { cpuPercent: null, memoryMb: null, diskMb: null },
      ports: app.ports,
    };
  },
};

export const builtinExtensions = [
  customExtension,
  nodeExtension,
  pythonExtension,
  discordBotExtension,
  websiteExtension,
];
