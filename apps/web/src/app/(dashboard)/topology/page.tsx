'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Network, Server, Blocks, Database, Bot, Globe, Shield,
  Activity, ArrowDown, ExternalLink, HardDrive, Cpu, Radio,
  CheckCircle2, XCircle, AlertTriangle
} from 'lucide-react';
import { fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Card, StatusBadge, Button, EmptyState, Modal, cx } from '@/components/ui';

interface NodeItem {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  platform: string | null;
  cpuCores: number | null;
  totalMemoryMb: number | null;
  lastMetrics: { cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number } | null;
}

interface AppItem {
  id: string;
  name: string;
  type: string;
  status: string;
  ports: number[];
  node: { id: string; name: string };
  config: Record<string, unknown>;
  lastMetrics: { cpuPercent: number; memoryMb: number } | null;
}

export default function TopologyPage() {
  const [selectedEntity, setSelectedEntity] = useState<{ kind: 'control' | 'node' | 'app'; data: unknown } | null>(null);

  const { data: nodesData, mutate: mNodes } = useSWR<{ nodes: NodeItem[] }>('/nodes', fetcher);
  const { data: appsData, mutate: mApps } = useSWR<{ applications: AppItem[] }>('/apps', fetcher);

  useRealtimeTopic('nodes', () => void mNodes());
  useRealtimeTopic('apps', () => void mApps());

  const nodes = nodesData?.nodes ?? [];
  const apps = appsData?.applications ?? [];

  const proxies = apps.filter((a) => (a.config as { isProxy?: boolean })?.isProxy || a.name.toLowerCase().includes('proxy') || a.name.toLowerCase().includes('velocity'));
  const gameServers = apps.filter((a) => a.type === 'minecraft' && !proxies.includes(a));
  const databases = apps.filter((a) => ['postgres', 'redis', 'mysql'].includes(a.type));
  const otherApps = apps.filter((a) => !proxies.includes(a) && !gameServers.includes(a) && !databases.includes(a));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Network size={22} className="text-accent" />
            <span>Network & Infrastructure Topology</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Visual map of control plane, regional compute nodes, game proxies, servers, and database links.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-raised border border-edge text-dim">
            <span className="w-2 h-2 rounded-full bg-ok pulse-dot" /> Online
          </span>
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-raised border border-edge text-dim">
            <span className="w-2 h-2 rounded-full bg-faint" /> Stopped
          </span>
        </div>
      </div>

      {/* Visual Topology Diagram Container */}
      <div className="p-6 rounded-2xl bg-gradient-to-b from-[#0b101a] to-[#070a10] border border-edge-strong shadow-2xl space-y-10 relative overflow-hidden">
        {/* Layer 1: Control Plane */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] uppercase font-bold text-faint tracking-widest mb-2 flex items-center gap-1.5">
            <Shield size={12} className="text-accent" />
            <span>Central Management & API Layer</span>
          </div>

          <div
            onClick={() => setSelectedEntity({ kind: 'control', data: {} })}
            className="w-full max-w-md p-4 rounded-xl bg-panel border-2 border-accent/40 shadow-xl shadow-accent/5 cursor-pointer hover:border-accent transition-all mc-card"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center text-accent text-lg shadow-inner">
                  🐤
                </div>
                <div>
                  <div className="text-sm font-bold text-ink">ChickenPanel Control Plane</div>
                  <div className="text-xs text-dim">Web (Port 3000) · API Gateway (Port 4000)</div>
                </div>
              </div>
              <StatusBadge status="ONLINE" />
            </div>
            <div className="mt-3 pt-2.5 border-t border-edge/60 flex items-center justify-between text-[11px] text-faint">
              <span>Fastify API & Realtime WebSockets</span>
              <span className="text-accent font-medium">Active Master</span>
            </div>
          </div>

          {/* Vertical Connecting Line */}
          <div className="w-0.5 h-8 bg-gradient-to-b from-accent to-edge-strong mt-2" />
        </div>

        {/* Layer 2: Compute Nodes */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase font-bold text-faint tracking-widest text-center flex items-center justify-center gap-1.5">
            <Server size={12} className="text-sky-400" />
            <span>Compute Infrastructure Nodes ({nodes.length})</span>
          </div>

          {nodes.length === 0 ? (
            <div className="text-center py-6 text-faint text-xs">
              No compute nodes linked. Register an agent node to see it here.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {nodes.map((node) => {
                const nodeApps = apps.filter((a) => a.node?.id === node.id);
                return (
                  <div
                    key={node.id}
                    onClick={() => setSelectedEntity({ kind: 'node', data: node })}
                    className={cx(
                      'p-4 rounded-xl border bg-panel transition-all cursor-pointer hover:border-sky-400/50 mc-card',
                      node.connected ? 'border-edge-strong' : 'border-bad/30 opacity-75',
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 grid place-items-center text-sky-400">
                          <Server size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-ink">{node.name}</div>
                          <div className="text-[11px] text-faint uppercase">{node.platform ?? 'linux'}</div>
                        </div>
                      </div>
                      <StatusBadge status={node.connected ? 'ONLINE' : 'OFFLINE'} />
                    </div>

                    {node.lastMetrics && node.connected ? (
                      <div className="mt-3 space-y-1.5 pt-2 border-t border-edge/50">
                        <div className="flex items-center justify-between text-xs text-dim">
                          <span>CPU Load:</span>
                          <span className="font-mono text-ink">{Math.round(node.lastMetrics.cpuPercent)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-dim">
                          <span>RAM Usage:</span>
                          <span className="font-mono text-ink">
                            {Math.round(node.lastMetrics.memoryUsedMb)} / {Math.round(node.lastMetrics.memoryTotalMb)} MB
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 pt-2 border-t border-edge/40 flex items-center justify-between text-[11px] text-faint">
                      <span>Applications hosted:</span>
                      <span className="font-semibold text-ink">{nodeApps.length}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Layer 3: Proxies & Ingress (if any) */}
        {proxies.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase font-bold text-faint tracking-widest text-center flex items-center justify-center gap-1.5">
              <Radio size={12} className="text-amber-400" />
              <span>Proxy & Ingress Gateway</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
              {proxies.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedEntity({ kind: 'app', data: p })}
                  className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <Radio size={18} className="text-amber-400" />
                    <div>
                      <div className="text-xs font-bold text-ink">{p.name}</div>
                      <div className="text-[11px] text-faint">Ports: {p.ports.map((pt) => `:${pt}`).join(', ')}</div>
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Layer 4: Hosted Applications & Services */}
        <div className="space-y-4">
          <div className="text-[10px] uppercase font-bold text-faint tracking-widest text-center flex items-center justify-center gap-1.5">
            <Blocks size={12} className="text-emerald-400" />
            <span>Hosted Servers, Bots & Databases ({apps.length})</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {apps.map((app) => {
              const isMc = app.type === 'minecraft';
              const isDb = ['postgres', 'redis', 'mysql'].includes(app.type);
              const isBot = app.type === 'discord-bot';

              return (
                <div
                  key={app.id}
                  onClick={() => setSelectedEntity({ kind: 'app', data: app })}
                  className={cx(
                    'p-3 rounded-xl border bg-panel/80 hover:bg-hover transition-all cursor-pointer mc-card flex flex-col justify-between space-y-2',
                    app.status === 'running' ? 'border-edge hover:border-accent' : 'border-edge/50 opacity-70',
                  )}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={cx(
                          'w-6 h-6 rounded-md grid place-items-center text-xs shrink-0',
                          isMc ? 'bg-emerald-500/15 text-emerald-400' : isDb ? 'bg-purple-500/15 text-purple-400' : isBot ? 'bg-indigo-500/15 text-indigo-400' : 'bg-raised text-dim',
                        )}
                      >
                        {isMc ? <Blocks size={13} /> : isDb ? <Database size={13} /> : <Globe size={13} />}
                      </div>
                      <div className="truncate">
                        <div className="text-xs font-semibold text-ink truncate">{app.name}</div>
                        <div className="text-[10px] text-faint truncate">{app.node.name}</div>
                      </div>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>

                  <div className="pt-2 border-t border-edge/40 flex items-center justify-between text-[10px] text-faint">
                    <span>{app.type}</span>
                    <span className="font-mono text-ink">
                      {app.ports.length > 0 ? `:${app.ports[0]}` : 'internal'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedEntity && (
        <Modal
          open={Boolean(selectedEntity)}
          onClose={() => setSelectedEntity(null)}
          title={
            selectedEntity.kind === 'control'
              ? 'ChickenPanel Control Plane Details'
              : selectedEntity.kind === 'node'
              ? `Node: ${(selectedEntity.data as NodeItem).name}`
              : `Application: ${(selectedEntity.data as AppItem).name}`
          }
        >
          {selectedEntity.kind === 'app' ? (
            (() => {
              const a = selectedEntity.data as AppItem;
              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">Status</div>
                      <div className="font-semibold text-ink mt-0.5"><StatusBadge status={a.status} /></div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">Type</div>
                      <div className="font-semibold text-ink mt-0.5">{a.type}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">Hosting Node</div>
                      <div className="font-semibold text-ink mt-0.5">{a.node?.name}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">Assigned Ports</div>
                      <div className="font-mono text-ink mt-0.5">{a.ports.join(', ') || 'None'}</div>
                    </div>
                  </div>

                  {a.lastMetrics && (
                    <div className="p-3 rounded-lg bg-raised border border-edge space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-dim">CPU:</span>
                        <span className="font-mono font-semibold text-ink">{Math.round(a.lastMetrics.cpuPercent)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-dim">RAM Allocated:</span>
                        <span className="font-mono font-semibold text-ink">{Math.round(a.lastMetrics.memoryMb)} MB</span>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-2">
                    <Link href={`/apps/${a.id}`}>
                      <Button variant="primary" size="sm">
                        <span>Open Server Details & Console</span>
                        <ExternalLink size={13} />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })()
          ) : selectedEntity.kind === 'node' ? (
            (() => {
              const n = selectedEntity.data as NodeItem;
              return (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">Platform</div>
                      <div className="font-semibold text-ink mt-0.5 uppercase">{n.platform ?? 'linux'}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-raised border border-edge">
                      <div className="text-faint">CPU Cores</div>
                      <div className="font-semibold text-ink mt-0.5">{n.cpuCores ?? '?'} Cores</div>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Link href="/nodes">
                      <Button variant="primary" size="sm">Manage Nodes</Button>
                    </Link>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="space-y-3 text-xs text-dim">
              <p>The control plane coordinates deployments, audits security, and aggregates realtime WebSocket streams.</p>
              <div className="p-3 rounded-lg bg-raised border border-edge space-y-1">
                <div>API: Fastify Server (Port 4000)</div>
                <div>Web UI: Next.js Platform (Port 3000)</div>
                <div>Embedded Database: PostgreSQL (Port 5490)</div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
