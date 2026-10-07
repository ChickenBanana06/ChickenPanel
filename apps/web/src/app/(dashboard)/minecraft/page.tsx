'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Blocks, Plus, Play, Square, RotateCw, Terminal, Users,
  Sparkles, Check, Server, Radio, Shield, Zap, Search,
  ChevronRight, ExternalLink
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Card, Button, StatusBadge, EmptyState, SearchInput, Modal, Tabs, cx, useToast } from '@/components/ui';
import { CreateAppModal, type McTemplate } from '@/components/app-list';

interface AppRow {
  id: string;
  name: string;
  type: string;
  status: string;
  node: { id: string; name: string };
  ports: number[];
  config: Record<string, unknown>;
  lastMetrics: { cpuPercent: number; memoryMb: number } | null;
}

const TEMPLATES: (McTemplate & {
  id: string;
  title: string;
  description: string;
  icon: string;
  badge: string;
  javaVersion: string;
  recommendedRam: string;
})[] = [
  {
    id: 'survival',
    title: 'Survival SMP (Paper)',
    name: 'survival-smp',
    description: 'High-performance vanilla survival server with optimized tick rate and plugin support for permissions, economy & claims.',
    icon: '🌲',
    badge: 'Popular',
    type: 'minecraft',
    software: 'paper',
    version: '1.21.1',
    memoryMb: 4096,
    difficulty: 'normal',
    gamemode: 'survival',
    viewDistance: 10,
    simulationDistance: 8,
    isProxy: false,
    javaVersion: 'Java 21',
    recommendedRam: '4 - 8 GB',
  },
  {
    id: 'lobby',
    title: 'Hub & Lobby Server',
    name: 'hub-lobby',
    description: 'Lightweight spawn / lobby server configured for instant player connections, adventure mode, and void world protection.',
    icon: '🏛️',
    badge: 'Hub',
    type: 'minecraft',
    software: 'paper',
    version: '1.21.1',
    memoryMb: 2048,
    difficulty: 'peaceful',
    gamemode: 'adventure',
    viewDistance: 6,
    simulationDistance: 4,
    isProxy: false,
    javaVersion: 'Java 21',
    recommendedRam: '2 - 4 GB',
  },
  {
    id: 'proxy',
    title: 'Velocity Modern Proxy',
    name: 'velocity-proxy',
    description: 'Next-generation high-speed proxy gateway to link multiple game servers together with Modern Forwarding & anti-bot protection.',
    icon: '🚀',
    badge: 'Proxy',
    type: 'minecraft',
    software: 'custom',
    version: 'custom',
    memoryMb: 1024,
    difficulty: 'peaceful',
    gamemode: 'survival',
    viewDistance: 6,
    simulationDistance: 4,
    isProxy: true,
    javaVersion: 'Java 21',
    recommendedRam: '1 - 2 GB',
  },
  {
    id: 'minigames',
    title: 'Minigames & Bedwars',
    name: 'minigames-arena',
    description: 'Tuned for rapid entity tracking, instant respawns, low tick delays, and tournament arena gameplay.',
    icon: '⚔️',
    badge: 'PVP',
    type: 'minecraft',
    software: 'paper',
    version: '1.21.1',
    memoryMb: 6144,
    difficulty: 'normal',
    gamemode: 'survival',
    viewDistance: 8,
    simulationDistance: 6,
    isProxy: false,
    javaVersion: 'Java 21',
    recommendedRam: '6 - 12 GB',
  },
  {
    id: 'hardcore',
    title: 'Hardcore Survival+',
    name: 'hardcore-survival',
    description: 'Ruthless permadeath hardcore survival server with maximum spawn difficulty, intense mob AI, and natural health regen balance.',
    icon: '💀',
    badge: 'Hardcore',
    type: 'minecraft',
    software: 'paper',
    version: '1.21.1',
    memoryMb: 4096,
    difficulty: 'hard',
    gamemode: 'survival',
    viewDistance: 10,
    simulationDistance: 8,
    isProxy: false,
    javaVersion: 'Java 21',
    recommendedRam: '4 - 8 GB',
  },
  {
    id: 'creative',
    title: 'Creative Plotworld',
    name: 'creative-plots',
    description: 'Creative building server ready for FastAsyncWorldEdit, plot generation, infinite block inventories, and builder ranks.',
    icon: '⚡',
    badge: 'Creative',
    type: 'minecraft',
    software: 'paper',
    version: '1.21.1',
    memoryMb: 3072,
    difficulty: 'peaceful',
    gamemode: 'creative',
    viewDistance: 8,
    simulationDistance: 6,
    isProxy: false,
    javaVersion: 'Java 21',
    recommendedRam: '3 - 6 GB',
  },
];

export default function MinecraftHubPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'servers' | 'templates'>('servers');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<McTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, mutate } = useSWR<{ applications: AppRow[] }>('/apps', fetcher);
  useRealtimeTopic('apps', () => void mutate());

  const mcServers = (data?.applications ?? []).filter((a) => a.type === 'minecraft');
  const filteredServers = mcServers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.node.name.toLowerCase().includes(search.toLowerCase()) ||
    s.ports.some((p) => String(p).includes(search)),
  );

  async function handleServerAction(id: string, action: 'start' | 'stop' | 'restart') {
    setBusyId(`${id}:${action}`);
    try {
      await api('POST', `/apps/${id}/${action}`);
      toast('success', `Minecraft server ${action} initiated`);
      void mutate();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyId(null);
    }
  }

  function deployTemplate(tpl: McTemplate) {
    setSelectedTemplate(tpl);
    setShowCreateModal(true);
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Blocks size={22} className="text-emerald-400" />
            <span>Minecraft Server Management Hub</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Deploy, monitor, and configure Paper, Purpur, Fabric, Vanilla, and Velocity proxy networks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setSelectedTemplate(null);
              setActiveTab('templates');
            }}
          >
            <Sparkles size={14} className="text-amber-400" />
            <span>Browse Templates</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedTemplate(null);
              setShowCreateModal(true);
            }}
          >
            <Plus size={14} />
            <span>Create Server</span>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'servers', label: 'Minecraft Servers', icon: Server, count: mcServers.length },
          { id: 'templates', label: 'Reusable Deployment Templates', icon: Sparkles, count: TEMPLATES.length },
        ]}
      />

      {/* Tab 1: Servers List */}
      {activeTab === 'servers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="w-full sm:w-72">
              <SearchInput value={search} onChange={setSearch} placeholder="Search Minecraft servers..." />
            </div>
            <div className="text-xs text-faint">
              Showing {filteredServers.length} of {mcServers.length} servers
            </div>
          </div>

          {filteredServers.length === 0 ? (
            <Card className="p-8 mc-card">
              <EmptyState
                title={mcServers.length === 0 ? 'No Minecraft servers created yet' : 'No servers matching search'}
                hint="Use one of our pre-tuned 1-click templates or create a custom server."
                action={
                  <Button variant="primary" onClick={() => setActiveTab('templates')}>
                    Deploy from Template
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredServers.map((s) => {
                const isRunning = s.status === 'running';
                const isProxy = (s.config as { isProxy?: boolean })?.isProxy;
                const software = (s.config as { software?: string })?.software ?? 'paper';
                const version = (s.config as { version?: string })?.version ?? '1.21.1';
                const memory = (s.config as { memoryMb?: number })?.memoryMb ?? 4096;
                const isBusy = busyId?.startsWith(s.id);

                return (
                  <Card
                    key={s.id}
                    className={cx(
                      'p-4 transition-all duration-200 border mc-card flex flex-col justify-between',
                      isRunning ? 'hover:border-emerald-500/50' : 'opacity-90',
                    )}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-emerald-400 text-lg shrink-0">
                            {isProxy ? '🚀' : '⛏️'}
                          </div>
                          <div className="min-w-0">
                            <Link href={`/apps/${s.id}`} className="font-semibold text-sm text-ink hover:text-accent truncate block">
                              {s.name}
                            </Link>
                            <span className="text-[11px] text-faint block truncate">
                              {s.node.name} · {software} {version}
                            </span>
                          </div>
                        </div>
                        <StatusBadge status={s.status} />
                      </div>

                      <div className="bg-raised/60 rounded-xl p-3 border border-edge/60 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-dim">
                          <span>Game Port:</span>
                          <span className="font-mono text-ink font-semibold">
                            {s.ports.length > 0 ? `:${s.ports.join(', :')}` : 'Auto'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-dim">
                          <span>Allocated RAM:</span>
                          <span className="font-mono text-ink">{Math.round(memory)} MB</span>
                        </div>
                        {isRunning && s.lastMetrics ? (
                          <>
                            <div className="flex items-center justify-between text-dim">
                              <span>Live CPU:</span>
                              <span className="font-mono text-ink">{Math.round(s.lastMetrics.cpuPercent)}%</span>
                            </div>
                            <div className="flex items-center justify-between text-dim">
                              <span>Used RAM:</span>
                              <span className="font-mono text-ink">{Math.round(s.lastMetrics.memoryMb)} MB</span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-edge/50 mt-3 gap-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/apps/${s.id}`} className="text-xs text-accent hover:underline flex items-center gap-1 font-medium">
                          <span>Manage</span>
                          <ChevronRight size={13} />
                        </Link>
                      </div>

                      <div className="flex items-center gap-1">
                        {isRunning ? (
                          <>
                            <Button
                              size="xs"
                              variant="default"
                              title="Restart Server"
                              disabled={isBusy}
                              onClick={() => void handleServerAction(s.id, 'restart')}
                            >
                              <RotateCw size={12} />
                            </Button>
                            <Button
                              size="xs"
                              variant="danger"
                              title="Stop Server"
                              disabled={isBusy}
                              onClick={() => void handleServerAction(s.id, 'stop')}
                            >
                              <Square size={12} />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="xs"
                            variant="success"
                            title="Start Server"
                            disabled={isBusy}
                            onClick={() => void handleServerAction(s.id, 'start')}
                          >
                            <Play size={12} />
                            <span>Start</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Reusable Templates */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-accent/10 border border-accent/25 flex items-start gap-3 text-xs">
            <Sparkles className="text-accent shrink-0 mt-0.5" size={18} />
            <div className="space-y-0.5">
              <span className="font-bold text-accent">1-Click Production Optimized Templates</span>
              <p className="text-dim">
                Each template includes pre-configured JVM memory flags, optimal view distance, simulation distances, and EULA acceptance.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEMPLATES.map((tpl) => (
              <Card key={tpl.id} className="p-4 mc-card flex flex-col justify-between space-y-4 hover:border-accent/40 transition-all">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-raised border border-edge grid place-items-center text-xl shadow-inner">
                        {tpl.icon}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-ink">{tpl.title}</h3>
                        <span className="text-[10px] uppercase font-bold text-accent tracking-wider">
                          {tpl.badge}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-dim leading-relaxed">
                    {tpl.description}
                  </p>

                  <div className="bg-raised/70 rounded-xl p-3 border border-edge/60 space-y-1.5 text-xs font-mono">
                    <div className="flex justify-between text-dim">
                      <span>Software:</span>
                      <span className="text-ink font-semibold">{tpl.software} {tpl.version}</span>
                    </div>
                    <div className="flex justify-between text-dim">
                      <span>Recommended RAM:</span>
                      <span className="text-ink">{tpl.recommendedRam}</span>
                    </div>
                    <div className="flex justify-between text-dim">
                      <span>Runtime:</span>
                      <span className="text-ink">{tpl.javaVersion}</span>
                    </div>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => deployTemplate(tpl)}
                >
                  <Plus size={14} />
                  <span>Deploy {tpl.title.split(' ')[0]} Server</span>
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Create Application Modal with template prefill */}
      <CreateAppModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setSelectedTemplate(null);
        }}
        onCreated={() => {
          setShowCreateModal(false);
          setSelectedTemplate(null);
          void mutate();
        }}
        allowedTypes={['minecraft']}
        initialTemplate={selectedTemplate}
      />
    </div>
  );
}
