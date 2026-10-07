'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Plus } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Field, Input, Modal, Select, StatusBadge, useToast, cx } from '@/components/ui';

interface AppRow {
  id: string; name: string; type: string; status: string;
  node: { id: string; name: string }; ports: number[];
  lastMetrics: { cpuPercent: number; memoryMb: number } | null;
}
interface NodeRow { id: string; name: string; connected: boolean }
interface McCatalog {
  software: { id: string; displayName: string; supportsPlugins: boolean; versions: { version: string; stable: boolean }[] }[];
}

/** Application list, optionally filtered by type. Shared by several pages. */
export function AppList({ typeFilter, title, createTypes }: { typeFilter?: string[]; title: string; createTypes?: string[] }) {
  const { data, mutate } = useSWR<{ applications: AppRow[] }>('/apps', fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  useRealtimeTopic('apps', () => void mutate());

  const allApps = (data?.applications ?? []).filter((a) => !typeFilter || typeFilter.includes(a.type));
  const apps = allApps.filter((a) =>
    !search ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.type.toLowerCase().includes(search.toLowerCase()) ||
    a.node?.name.toLowerCase().includes(search.toLowerCase()) ||
    a.ports.some((p) => String(p).includes(search)),
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              className="w-full rounded-lg bg-panel border border-edge-strong px-2.5 py-1 text-xs text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> Create</span>
          </Button>
        </div>
      </div>
      <Card>
        {apps.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} hint="Create one or ask the AI assistant." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint border-b border-edge">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Node</th>
                <th className="px-4 py-2.5 font-medium">Ports</th>
                <th className="px-4 py-2.5 font-medium">CPU / RAM</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id} className="border-b border-edge/50 last:border-0 hover:bg-hover/50">
                  <td className="px-4 py-2.5">
                    <Link href={`/apps/${a.id}`} className="text-accent hover:underline font-medium">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-dim">{a.type}</td>
                  <td className="px-4 py-2.5 text-dim">{a.node?.name}</td>
                  <td className="px-4 py-2.5 text-dim">{a.ports.join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-dim text-xs">
                    {a.status === 'running' && a.lastMetrics
                      ? `${Math.round(a.lastMetrics.cpuPercent)}% / ${Math.round(a.lastMetrics.memoryMb)} MB`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <CreateAppModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); void mutate(); }}
        allowedTypes={createTypes ?? typeFilter}
      />
    </div>
  );
}

export interface McTemplate {
  name?: string;
  type?: string;
  software?: string;
  version?: string;
  memoryMb?: number;
  difficulty?: string;
  gamemode?: string;
  viewDistance?: number;
  simulationDistance?: number;
  isProxy?: boolean;
}

export function CreateAppModal({
  open, onClose, onCreated, allowedTypes, initialTemplate,
}: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void; allowedTypes?: string[];
  initialTemplate?: McTemplate | null;
}) {
  const toast = useToast();
  const { data: typesData } = useSWR<{ types: { type: string; displayName: string; description: string }[] }>(
    open ? '/apps/types' : null, fetcher,
  );
  const { data: nodesData, mutate: mutateNodes } = useSWR<{ nodes: NodeRow[] }>(open ? '/nodes' : null, fetcher);
  const types = (typesData?.types ?? []).filter((t) => !allowedTypes || allowedTypes.includes(t.type));
  const nodes = (nodesData?.nodes ?? []).filter((n) => n.connected);

  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [busy, setBusy] = useState(false);
  // generic config
  const [startCommand, setStartCommand] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [envText, setEnvText] = useState('');
  // minecraft config
  const [mcSoftware, setMcSoftware] = useState('paper');
  const [mcVersion, setMcVersion] = useState('');
  const [mcMemory, setMcMemory] = useState(4096);
  const [mcDifficulty, setMcDifficulty] = useState('normal');
  const [mcGamemode, setMcGamemode] = useState('survival');
  const [mcView, setMcView] = useState(10);
  const [mcSim, setMcSim] = useState(10);
  const [mcAutoStart, setMcAutoStart] = useState(true);
  const [mcEula, setMcEula] = useState(true);
  const [mcCustomMode, setMcCustomMode] = useState<'url' | 'upload'>('url');
  const [mcCustomUrl, setMcCustomUrl] = useState('');
  const [mcCustomFile, setMcCustomFile] = useState<File | null>(null);
  const [mcIsProxy, setMcIsProxy] = useState(false);
  // database config
  const [dbMemory, setDbMemory] = useState(0);
  const [dbName, setDbName] = useState('appdb');

  useEffect(() => {
    if (initialTemplate) {
      if (initialTemplate.name) setName(initialTemplate.name);
      if (initialTemplate.type) setType(initialTemplate.type);
      if (initialTemplate.software) setMcSoftware(initialTemplate.software);
      if (initialTemplate.version) setMcVersion(initialTemplate.version);
      if (initialTemplate.memoryMb) setMcMemory(initialTemplate.memoryMb);
      if (initialTemplate.difficulty) setMcDifficulty(initialTemplate.difficulty);
      if (initialTemplate.gamemode) setMcGamemode(initialTemplate.gamemode);
      if (initialTemplate.viewDistance) setMcView(initialTemplate.viewDistance);
      if (initialTemplate.simulationDistance) setMcSim(initialTemplate.simulationDistance);
      if (initialTemplate.isProxy !== undefined) setMcIsProxy(initialTemplate.isProxy);
      setMcEula(true);
    }
  }, [initialTemplate, open]);

  const effectiveType = type || types[0]?.type || '';
  const effectiveNode = nodeId || nodes[0]?.id || '';
  const { data: mcCatalog } = useSWR<{ catalog: McCatalog }>(
    open && effectiveType === 'minecraft' ? '/apps/types/minecraft/catalog' : null,
    fetcher,
  );
  const softwareVersions = mcCatalog?.catalog.software.find((s) => s.id === mcSoftware)?.versions ?? [];
  const effectiveMcVersion = mcVersion || softwareVersions.find((v) => v.stable)?.version || softwareVersions[0]?.version || '';

  async function create() {
    setBusy(true);
    try {
      const env: Record<string, string> = {};
      for (const line of envText.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      const isCustomMc = effectiveType === 'minecraft' && mcSoftware === 'custom';
      const customUpload = isCustomMc && mcCustomMode === 'upload' && mcCustomFile;
      let config: Record<string, unknown> = {};
      if (effectiveType === 'minecraft') {
        config = {
          software: mcSoftware,
          version: mcSoftware === 'custom' ? 'custom' : effectiveMcVersion,
          memoryMb: mcMemory,
          difficulty: mcDifficulty, gamemode: mcGamemode,
          viewDistance: mcView, simulationDistance: mcSim,
          // Upload-based custom jars must not auto-start before the jar is uploaded.
          autoStart: customUpload ? false : mcAutoStart,
          eulaAccepted: mcEula,
          isProxy: mcIsProxy,
          ...(isCustomMc && mcCustomMode === 'url' && mcCustomUrl ? { customJarUrl: mcCustomUrl } : {}),
          ...(customUpload ? { customUploaded: true } : {}),
        };
      } else if (effectiveType === 'redis') {
        if (dbMemory) config.maxMemoryMb = dbMemory;
      } else if (effectiveType === 'postgres') {
        config.database = dbName || 'appdb';
      } else if (effectiveType === 'mysql') {
        config = {};
      } else {
        if (startCommand) config.startCommand = startCommand;
        if (installCommand) config.installCommand = installCommand;
        if (gitUrl) config.gitUrl = gitUrl;
      }
      const res = await api<{ application: { id: string } }>('POST', '/apps', {
        name, type: effectiveType, nodeId: effectiveNode, config, env,
      });
      // For a custom uploaded jar, push it to server.jar after creation.
      if (customUpload && mcCustomFile) {
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const r = reader.result as string;
            resolve(r.slice(r.indexOf(',') + 1));
          };
          reader.onerror = () => reject(new Error('Could not read jar'));
          reader.readAsDataURL(mcCustomFile);
        });
        await api('PUT', `/apps/${res.application.id}/files/content`, { path: 'server.jar', content: b64, base64: true });
        toast('success', 'Server created and jar uploaded — start it when provisioning finishes');
      } else {
        toast('success', 'Application created — provisioning started');
      }
      onCreated(res.application.id);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create application" wide>
      <div className="space-y-4">
        {nodes.length === 0 && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between gap-3 text-xs">
            <span className="text-amber-400">No online nodes available to host applications.</span>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                try {
                  await api('POST', '/nodes/auto-connect-local');
                  toast('success', 'Local node connected!');
                  void mutateNodes();
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Failed to connect local node');
                }
              }}
            >
              ⚡ Auto-Connect Local Server
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-server" />
          </Field>
          <Field label="Type">
            <Select value={effectiveType} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t.type} value={t.type}>{t.displayName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Node">
            <Select value={effectiveNode} onChange={(e) => setNodeId(e.target.value)}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {effectiveType === 'minecraft' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Server software">
              <Select value={mcSoftware} onChange={(e) => { setMcSoftware(e.target.value); setMcVersion(''); }}>
                {(mcCatalog?.catalog.software ?? [
                  { id: 'paper', displayName: 'Paper' },
                  { id: 'vanilla', displayName: 'Vanilla' },
                ]).map((s: { id: string; displayName: string }) => (
                  <option key={s.id} value={s.id}>{s.displayName}</option>
                ))}
                <option value="custom">Custom JAR (any software / upload / URL)</option>
              </Select>
            </Field>
            {mcSoftware === 'custom' ? (
              <Field label="Custom server jar">
                <div className="space-y-2">
                  <div className="flex gap-1.5 text-xs">
                    <button
                      type="button"
                      className={cx('px-2 py-1 rounded-lg border', mcCustomMode === 'url' ? 'border-accent text-accent' : 'border-edge-strong text-dim')}
                      onClick={() => setMcCustomMode('url')}
                    >
                      From URL
                    </button>
                    <button
                      type="button"
                      className={cx('px-2 py-1 rounded-lg border', mcCustomMode === 'upload' ? 'border-accent text-accent' : 'border-edge-strong text-dim')}
                      onClick={() => setMcCustomMode('upload')}
                    >
                      Upload .jar
                    </button>
                  </div>
                  {mcCustomMode === 'url' ? (
                    <Input value={mcCustomUrl} onChange={(e) => setMcCustomUrl(e.target.value)} placeholder="https://.../server.jar" />
                  ) : (
                    <input
                      type="file"
                      accept=".jar"
                      className="text-xs text-dim"
                      onChange={(e) => setMcCustomFile(e.target.files?.[0] ?? null)}
                    />
                  )}
                </div>
              </Field>
            ) : (
              <Field label="Version">
                <Select value={effectiveMcVersion} onChange={(e) => setMcVersion(e.target.value)}>
                  {softwareVersions.map((v) => (
                    <option key={v.version} value={v.version}>{v.version}{v.stable ? '' : ' (unstable)'}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Memory (MB)">
              <Input type="number" min={512} value={mcMemory} onChange={(e) => setMcMemory(Number(e.target.value))} />
            </Field>
            <Field label="Difficulty">
              <Select value={mcDifficulty} onChange={(e) => setMcDifficulty(e.target.value)}>
                {['peaceful', 'easy', 'normal', 'hard'].map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Gamemode">
              <Select value={mcGamemode} onChange={(e) => setMcGamemode(e.target.value)}>
                {['survival', 'creative', 'adventure', 'spectator'].map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="View distance">
              <Input type="number" min={2} max={32} value={mcView} onChange={(e) => setMcView(Number(e.target.value))} />
            </Field>
            <Field label="Simulation distance">
              <Input type="number" min={2} max={32} value={mcSim} onChange={(e) => setMcSim(Number(e.target.value))} />
            </Field>
            <label className="flex items-center gap-2 text-xs text-dim mt-5">
              <input type="checkbox" checked={mcAutoStart} onChange={(e) => setMcAutoStart(e.target.checked)} />
              Start automatically after install
            </label>
            {mcSoftware === 'custom' && (
              <label className="flex items-center gap-2 text-xs text-dim mt-5">
                <input type="checkbox" checked={mcIsProxy} onChange={(e) => setMcIsProxy(e.target.checked)} />
                This is a proxy (Velocity / BungeeCord)
              </label>
            )}
            {!mcIsProxy && (
              <label className="col-span-2 flex items-start gap-2 text-xs border border-warn/30 bg-warn/5 rounded-lg p-3">
                <input type="checkbox" className="mt-0.5" checked={mcEula} onChange={(e) => setMcEula(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Minecraft End User License Agreement
                  </a>
                  . The server will not start without accepting it.
                </span>
              </label>
            )}
            {mcSoftware === 'custom' && (
              <p className="col-span-2 text-xs text-faint">
                Custom JAR supports any Java server software — Spigot, Forge, NeoForge, Fabric, Mohist, Folia, proxies and more.
                Upload the jar or provide a direct download URL.
              </p>
            )}
          </div>
        ) : ['redis', 'postgres', 'mysql'].includes(effectiveType) ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-edge bg-raised/40 p-3 text-xs text-dim">
              A secure password is generated automatically. After it starts, open the database and see the{' '}
              <span className="text-ink">Connection</span> tab for credentials and the connection string.
              {effectiveType === 'redis' && ' Redis downloads a standalone server on Windows automatically.'}
              {effectiveType === 'postgres' && ' PostgreSQL requires the postgres/initdb binaries on the node.'}
              {effectiveType === 'mysql' && ' MySQL/MariaDB requires the mysqld binary on the node.'}
            </div>
            {effectiveType === 'redis' && (
              <Field label="Max memory in MB (optional, 0 = unlimited)">
                <Input type="number" min={0} value={dbMemory} onChange={(e) => setDbMemory(Number(e.target.value))} />
              </Field>
            )}
            {effectiveType === 'postgres' && (
              <Field label="Database name">
                <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="appdb" />
              </Field>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Git repository (optional, https)">
              <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/user/repo.git" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Install command (optional)">
                <Input value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} placeholder="npm install" />
              </Field>
              <Field label={effectiveType === 'website' ? 'Start command (static sites ignore this)' : 'Start command'}>
                <Input value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start" />
              </Field>
            </div>
            <Field label="Environment variables (KEY=value, one per line)">
              <textarea
                className="w-full rounded-lg bg-panel border border-edge-strong px-3 py-1.5 text-sm console-font min-h-20"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={effectiveType === 'discord-bot' ? 'DISCORD_TOKEN=…' : 'KEY=value'}
              />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={
              busy || !name || !effectiveNode || !effectiveType ||
              (effectiveType === 'minecraft' && !mcIsProxy && !mcEula) ||
              (effectiveType === 'minecraft' && mcSoftware === 'custom' && mcCustomMode === 'url' && !mcCustomUrl) ||
              (effectiveType === 'minecraft' && mcSoftware === 'custom' && mcCustomMode === 'upload' && !mcCustomFile)
            }
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
