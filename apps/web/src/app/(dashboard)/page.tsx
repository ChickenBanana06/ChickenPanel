'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Server, Boxes, ListChecks, Activity, HardDrive, Cpu, Terminal,
  Play, Square, RotateCw, Blocks, Database, Bot, Globe, ChevronRight,
  ShieldCheck, AlertCircle
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Card, StatusBadge, EmptyState, Button, SearchInput, ResourceGauge, cx, useToast } from '@/components/ui';

interface NodeRow {
  id: string;
  name: string;
  status: string;
  connected: boolean;
  platform: string | null;
  cpuCores: number | null;
  totalMemoryMb: number | null;
  totalDiskMb: number | null;
  lastMetrics: { cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number } | null;
  applicationCount: number;
}

interface AppRow {
  id: string;
  name: string;
  type: string;
  status: string;
  node: { id: string; name: string };
  ports: number[];
  lastMetrics: { cpuPercent: number; memoryMb: number; uptimeSeconds: number } | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  progress: number;
  createdAt: string;
}

export default function DashboardPage() {
  const toast = useToast();
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const { data: nodes, mutate: mNodes } = useSWR<{ nodes: NodeRow[] }>('/nodes', fetcher);
  const { data: apps, mutate: mApps } = useSWR<{ applications: AppRow[] }>('/apps', fetcher);
  const { data: tasks, mutate: mTasks } = useSWR<{ tasks: TaskRow[] }>('/tasks?limit=6', fetcher);

  useRealtimeTopic('nodes', () => void mNodes());
  useRealtimeTopic('apps', () => void mApps());
  useRealtimeTopic('tasks', () => void mTasks());

  const nodeList = nodes?.nodes ?? [];
  const appList = apps?.applications ?? [];
  const taskList = tasks?.tasks ?? [];

  // Cluster aggregate telemetry
  const onlineNodes = nodeList.filter((n) => n.connected);
  const totalCores = onlineNodes.reduce((acc, n) => acc + (n.cpuCores ?? 0), 0);
  const totalMemoryMb = onlineNodes.reduce((acc, n) => acc + (n.totalMemoryMb ?? 0), 0);
  const usedMemoryMb = onlineNodes.reduce((acc, n) => acc + (n.lastMetrics?.memoryUsedMb ?? 0), 0);
  const memoryPercent = totalMemoryMb > 0 ? (usedMemoryMb / totalMemoryMb) * 100 : 0;

  const avgCpuPercent = onlineNodes.length > 0
    ? onlineNodes.reduce((acc, n) => acc + (n.lastMetrics?.cpuPercent ?? 0), 0) / onlineNodes.length
    : 0;

  const runningApps = appList.filter((a) => a.status === 'running');

  // Filter applications
  const filteredApps = appList.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase()) ||
      a.node.name.toLowerCase().includes(search.toLowerCase()) ||
      a.ports.some((p) => String(p).includes(search));

    if (!matchesSearch) return false;
    if (filterType === 'all') return true;
    if (filterType === 'running') return a.status === 'running';
    if (filterType === 'stopped') return a.status === 'stopped';
    if (filterType === 'minecraft') return a.type === 'minecraft';
    if (filterType === 'database') return ['postgres', 'redis', 'mysql'].includes(a.type);
    if (filterType === 'bot') return a.type === 'discord-bot';
    return true;
  });

  async function handleAppAction(id: string, action: 'start' | 'stop' | 'restart') {
    setBusyAction(`${id}:${action}`);
    try {
      await api('POST', `/apps/${id}/${action}`);
      toast('success', `Server ${action} triggered`);
      void mApps();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <span>Cluster Dashboard</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent font-medium border border-accent/30">
              Live
            </span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Real-time multi-node cluster health, Minecraft servers, and telemetry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/minecraft">
            <Button variant="diamond" size="sm">
              <Blocks size={14} />
              <span>Minecraft Hub</span>
            </Button>
          </Link>
          <Link href="/console">
            <Button variant="default" size="sm">
              <Terminal size={14} />
              <span>Multi-Console</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Cluster Telemetry Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 mc-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-dim font-medium">Cluster CPU</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 grid place-items-center">
              <Cpu size={15} />
            </div>
          </div>
          <div className="text-2xl font-bold text-ink mb-1">
            {Math.round(avgCpuPercent)}%
          </div>
          <div className="text-[11px] text-faint mb-2">
            {totalCores > 0 ? `${totalCores} total cores across ${onlineNodes.length} nodes` : 'Awaiting node metrics'}
          </div>
          <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
            <div
              className={cx('h-full transition-all duration-500', avgCpuPercent > 80 ? 'bg-bad' : 'bg-ok')}
              style={{ width: `${Math.min(100, Math.round(avgCpuPercent))}%` }}
            />
          </div>
        </Card>

        <Card className="p-4 mc-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-dim font-medium">Cluster Memory (RAM)</span>
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 grid place-items-center">
              <Activity size={15} />
            </div>
          </div>
          <div className="text-2xl font-bold text-ink mb-1">
            {Math.round(memoryPercent)}%
          </div>
          <div className="text-[11px] text-faint mb-2">
            {(usedMemoryMb / 1024).toFixed(1)} GB / {(totalMemoryMb / 1024).toFixed(1)} GB used
          </div>
          <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
            <div
              className={cx('h-full transition-all duration-500', memoryPercent > 85 ? 'bg-bad' : 'bg-sky-400')}
              style={{ width: `${Math.min(100, Math.round(memoryPercent))}%` }}
            />
          </div>
        </Card>

        <Card className="p-4 mc-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-dim font-medium">Nodes Connected</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 grid place-items-center">
              <Server size={15} />
            </div>
          </div>
          <div className="text-2xl font-bold text-ink mb-1">
            {onlineNodes.length} / {nodeList.length}
          </div>
          <div className="text-[11px] text-faint mb-2">
            {nodeList.length - onlineNodes.length === 0 ? 'All cluster nodes healthy' : `${nodeList.length - onlineNodes.length} offline nodes`}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ok">
            <span className="w-2 h-2 rounded-full bg-ok pulse-dot" />
            <span>Operational</span>
          </div>
        </Card>

        <Card className="p-4 mc-card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-dim font-medium">Active Applications</span>
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 grid place-items-center">
              <Boxes size={15} />
            </div>
          </div>
          <div className="text-2xl font-bold text-ink mb-1">
            {runningApps.length} <span className="text-xs font-normal text-dim">/ {appList.length}</span>
          </div>
          <div className="text-[11px] text-faint mb-2">
            {runningApps.filter((a) => a.type === 'minecraft').length} Minecraft · {runningApps.filter((a) => ['postgres', 'redis'].includes(a.type)).length} DBs
          </div>
          <div className="flex items-center gap-1.5 text-xs text-dim">
            <Link href="/apps" className="text-accent hover:underline flex items-center gap-1">
              <span>Manage all</span>
              <ChevronRight size={12} />
            </Link>
          </div>
        </Card>
      </div>

      {/* Main Server Health & Cards Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {[
              { id: 'all', label: 'All Servers' },
              { id: 'minecraft', label: 'Minecraft', icon: Blocks },
              { id: 'running', label: 'Running' },
              { id: 'stopped', label: 'Stopped' },
              { id: 'database', label: 'Databases', icon: Database },
              { id: 'bot', label: 'Bots', icon: Bot },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={cx(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer whitespace-nowrap',
                  filterType === tab.id
                    ? 'bg-accent/15 border-accent text-accent font-semibold shadow-sm'
                    : 'bg-raised/50 border-edge-strong text-dim hover:text-ink hover:bg-hover',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-64">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter servers..." />
          </div>
        </div>

        {filteredApps.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title={appList.length === 0 ? 'No applications deployed' : 'No servers matching filter'}
              hint={appList.length === 0 ? 'Create a Minecraft server or ask the AI operator to spin one up.' : 'Try adjusting your search query or filter selection.'}
              action={
                appList.length === 0 ? (
                  <Link href="/apps">
                    <Button variant="primary">Create Application</Button>
                  </Link>
                ) : null
              }
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredApps.map((app) => {
              const isMc = app.type === 'minecraft';
              const isDb = ['postgres', 'redis', 'mysql'].includes(app.type);
              const isRunning = app.status === 'running';
              const isBusy = busyAction?.startsWith(app.id);

              return (
                <Card
                  key={app.id}
                  className={cx(
                    'p-4 transition-all duration-200 border mc-card flex flex-col justify-between',
                    isRunning ? 'hover:border-accent/50' : 'opacity-85 hover:opacity-100',
                  )}
                >
                  <div className="space-y-3">
                    {/* Card Topbar */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={cx(
                            'w-8 h-8 rounded-lg grid place-items-center shrink-0 border',
                            isMc
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : isDb
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                              : 'bg-raised text-dim border-edge-strong',
                          )}
                        >
                          {isMc ? <Blocks size={16} /> : isDb ? <Database size={16} /> : <Boxes size={16} />}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/apps/${app.id}`} className="font-semibold text-sm text-ink hover:text-accent truncate block">
                            {app.name}
                          </Link>
                          <span className="text-[11px] text-faint block truncate">
                            {app.node.name} · {app.type}
                          </span>
                        </div>
                      </div>
                      <StatusBadge status={app.status} />
                    </div>

                    {/* Telemetry / Ports */}
                    <div className="bg-raised/60 rounded-lg p-2.5 border border-edge/60 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-dim">
                        <span>Ports:</span>
                        <span className="font-mono text-ink">
                          {app.ports.length > 0 ? app.ports.map((p) => `:${p}`).join(', ') : 'None'}
                        </span>
                      </div>
                      {isRunning && app.lastMetrics ? (
                        <>
                          <div className="flex items-center justify-between text-dim">
                            <span>CPU:</span>
                            <span className="text-ink font-mono">{Math.round(app.lastMetrics.cpuPercent)}%</span>
                          </div>
                          <div className="flex items-center justify-between text-dim">
                            <span>RAM:</span>
                            <span className="text-ink font-mono">{Math.round(app.lastMetrics.memoryMb)} MB</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-faint text-[11px] text-center py-1">
                          Server offline
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex items-center justify-between pt-3 border-t border-edge/50 mt-3 gap-1">
                    <Link href={`/apps/${app.id}`} className="text-xs text-accent hover:underline flex items-center gap-1 font-medium">
                      <span>Console & Files</span>
                      <ChevronRight size={13} />
                    </Link>

                    <div className="flex items-center gap-1">
                      {isRunning ? (
                        <>
                          <Button
                            size="xs"
                            variant="default"
                            title="Restart"
                            disabled={isBusy}
                            onClick={() => void handleAppAction(app.id, 'restart')}
                          >
                            <RotateCw size={12} />
                          </Button>
                          <Button
                            size="xs"
                            variant="danger"
                            title="Stop"
                            disabled={isBusy}
                            onClick={() => void handleAppAction(app.id, 'stop')}
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
                          onClick={() => void handleAppAction(app.id, 'start')}
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

      {/* Cluster Nodes & Recent Tasks Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Nodes Health Card */}
        <Card className="p-4 lg:col-span-2 mc-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Server size={15} className="text-accent" />
              <span>Node Infrastructure Health</span>
            </h2>
            <Link href="/nodes" className="text-xs text-accent hover:underline">
              View all ({nodeList.length})
            </Link>
          </div>

          {nodeList.length === 0 ? (
            <EmptyState title="No nodes connected" hint="Link a machine using 'chickenpanel node register' to deploy servers." />
          ) : (
            <div className="space-y-2">
              {nodeList.map((node) => (
                <div
                  key={node.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg border border-edge bg-raised/40 hover:bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', node.connected ? 'bg-ok pulse-dot' : 'bg-bad')} />
                    <div>
                      <div className="text-sm font-medium text-ink flex items-center gap-2">
                        <span>{node.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-edge text-dim uppercase">
                          {node.platform ?? 'linux'}
                        </span>
                      </div>
                      <div className="text-xs text-faint">
                        {node.cpuCores ?? '?'} cores · {node.totalMemoryMb ? `${Math.round(node.totalMemoryMb / 1024)} GB RAM` : '?'} · {node.applicationCount} servers
                      </div>
                    </div>
                  </div>

                  {node.lastMetrics && node.connected ? (
                    <div className="flex items-center gap-4 text-xs font-mono">
                      <div>
                        <span className="text-faint">CPU:</span>{' '}
                        <span className="text-ink font-semibold">{Math.round(node.lastMetrics.cpuPercent)}%</span>
                      </div>
                      <div>
                        <span className="text-faint">RAM:</span>{' '}
                        <span className="text-ink font-semibold">
                          {Math.round((node.lastMetrics.memoryUsedMb / node.lastMetrics.memoryTotalMb) * 100)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-faint">No telemetry</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Tasks Card */}
        <Card className="p-4 mc-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <ListChecks size={15} className="text-accent" />
              <span>Background Tasks</span>
            </h2>
            <Link href="/tasks" className="text-xs text-accent hover:underline">
              All tasks
            </Link>
          </div>

          {taskList.length === 0 ? (
            <EmptyState title="No recent tasks" hint="Application provisions and backups will appear here." />
          ) : (
            <div className="space-y-2.5">
              {taskList.map((task) => (
                <div key={task.id} className="p-2.5 rounded-lg border border-edge/60 bg-raised/30 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink truncate pr-2">{task.title}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  {['running', 'queued'].includes(task.status) && (
                    <div className="h-1 w-full rounded-full bg-raised overflow-hidden">
                      <div className="h-full bg-accent animate-pulse" style={{ width: `${Math.max(15, task.progress)}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
