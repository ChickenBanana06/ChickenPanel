'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Plus } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Field, Input, Modal, Select, StatusBadge, useToast } from '@/components/ui';

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
  useRealtimeTopic('apps', () => void mutate());

  const apps = (data?.applications ?? []).filter((a) => !typeFilter || typeFilter.includes(a.type));

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <span className="flex items-center gap-1.5"><Plus size={14} /> Create</span>
        </Button>
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

export function CreateAppModal({
  open, onClose, onCreated, allowedTypes,
}: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void; allowedTypes?: string[];
}) {
  const toast = useToast();
  const { data: typesData } = useSWR<{ types: { type: string; displayName: string; description: string }[] }>(
    open ? '/apps/types' : null, fetcher,
  );
  const { data: nodesData } = useSWR<{ nodes: NodeRow[] }>(open ? '/nodes' : null, fetcher);
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
      let config: Record<string, unknown> = {};
      if (effectiveType === 'minecraft') {
        config = {
          software: mcSoftware, version: effectiveMcVersion, memoryMb: mcMemory,
          difficulty: mcDifficulty, gamemode: mcGamemode,
          viewDistance: mcView, simulationDistance: mcSim, autoStart: mcAutoStart,
        };
      } else {
        if (startCommand) config.startCommand = startCommand;
        if (installCommand) config.installCommand = installCommand;
        if (gitUrl) config.gitUrl = gitUrl;
      }
      const res = await api<{ application: { id: string } }>('POST', '/apps', {
        name, type: effectiveType, nodeId: effectiveNode, config, env,
      });
      toast('success', 'Application created — provisioning started');
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
          <p className="text-xs text-warn">No online nodes. Add and connect a node first.</p>
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
              </Select>
            </Field>
            <Field label="Version">
              <Select value={effectiveMcVersion} onChange={(e) => setMcVersion(e.target.value)}>
                {softwareVersions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}{v.stable ? '' : ' (unstable)'}</option>
                ))}
              </Select>
            </Field>
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
          <Button variant="primary" disabled={busy || !name || !effectiveNode || !effectiveType} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
