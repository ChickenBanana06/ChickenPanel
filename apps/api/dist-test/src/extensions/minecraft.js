import { z } from 'zod';
import { MinecraftConfigSchema, buildMinecraftProvisioning, buildStartCommand, getMinecraftCatalog, } from '@nexpanel/ext-minecraft';
/** Resolve a Modrinth plugin project+game version to a downloadable jar. */
async function resolveModrinthPlugin(projectSlug, gameVersion) {
    const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}/version?loaders=${encodeURIComponent('["paper","spigot","bukkit"]')}&game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`, { headers: { 'user-agent': 'nexpanel/0.1' } });
    if (!res.ok)
        throw new Error(`Modrinth lookup failed (${res.status}) for ${projectSlug}`);
    const versions = (await res.json());
    const first = versions[0];
    if (!first)
        throw new Error(`No compatible version of ${projectSlug} for Minecraft ${gameVersion}`);
    const file = first.files.find((f) => f.primary) ?? first.files[0];
    if (!file)
        throw new Error('Version has no files');
    return { url: file.url, filename: file.filename };
}
export const minecraftExtension = {
    type: 'minecraft',
    displayName: 'Minecraft server',
    description: 'Vanilla or Paper Minecraft server with console, backups and plugin management.',
    configSchema: MinecraftConfigSchema,
    getCatalog: getMinecraftCatalog,
    async buildCreation(input, ctx) {
        const cfg = MinecraftConfigSchema.parse(input.config);
        const [port] = await ctx.allocatePorts(input.nodeId, 1, cfg.preferredPort ? [cfg.preferredPort] : []);
        if (!port)
            throw new Error('Port allocation failed');
        const env = { ...input.env };
        const plan = await buildMinecraftProvisioning(input.name, cfg, port, env, input.restartPolicy);
        return {
            spec: { appId: 'pending', ...plan.spec },
            steps: plan.steps,
            ports: [port],
            config: { ...cfg, port },
            env,
        };
    },
    buildRuntimeSpec(app) {
        const cfg = MinecraftConfigSchema.parse(app.config);
        return {
            appId: app.id,
            name: app.name,
            type: 'minecraft',
            startCommand: buildStartCommand(cfg),
            stopMethod: { type: 'stdin', command: 'stop' },
            stopGraceSeconds: 60,
            env: app.env ?? {},
            restartPolicy: app.restartPolicy,
            limits: { cpuPercent: null, memoryMb: cfg.memoryMb + 1024, diskMb: null },
            ports: app.ports,
        };
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
                const a = args;
                const cfg = MinecraftConfigSchema.parse(app.config);
                if (cfg.software === 'vanilla')
                    throw new Error('Vanilla servers do not support plugins — use Paper');
                let url;
                let filename;
                if (a.source === 'modrinth') {
                    if (!a.project)
                        throw new Error('project (Modrinth slug) is required');
                    const resolved = await resolveModrinthPlugin(a.project, cfg.version);
                    url = resolved.url;
                    filename = a.filename ?? resolved.filename;
                }
                else {
                    if (!a.url)
                        throw new Error('url is required');
                    url = a.url;
                    filename = a.filename ?? new URL(a.url).pathname.split('/').pop() ?? 'plugin.jar';
                }
                if (!/^[\w.-]+\.jar$/i.test(filename))
                    throw new Error(`Refusing suspicious plugin filename: ${filename}`);
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
                const a = args;
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
                const res = await helpers.command({ op: 'fs.list', appId: app.id, path: 'plugins' });
                return { plugins: res.entries.filter((e) => e.type === 'file' && e.name.endsWith('.jar')).map((e) => e.name) };
            },
        },
    ],
};
//# sourceMappingURL=minecraft.js.map