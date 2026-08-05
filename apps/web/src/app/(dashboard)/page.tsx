'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { Server, Boxes, ListChecks, Activity } from 'lucide-react';
import { fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Card, StatusBadge, EmptyState } from '@/components/ui';

interface NodeRow {
  id: string; name: string; status: string; connected: boolean; platform: string | null;
  cpuCores: number | null; totalMemoryMb: number | null;
  lastMetrics: { cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number } | null;
  applicationCount: number;
}
interface AppRow {
  id: string; name: string; type: string; status: string;
  node: { name: string }; ports: number[];
}
interface TaskRow { id: string; title: string; status: string; progress: number; createdAt: string }

export default function DashboardPage() {
  const { data: nodes, mutate: mNodes } = useSWR<{ nodes: NodeRow[] }>('/nodes', fetcher);
  const { data: apps, mutate: mApps } = useSWR<{ applications: AppRow[] }>('/apps', fetcher);
  const { data: tasks, mutate: mTasks } = useSWR<{ tasks: TaskRow[] }>('/tasks?limit=8', fetcher);

  useRealtimeTopic('nodes', () => void mNodes());
  useRealtimeTopic('apps', () => void mApps());
  useRealtimeTopic('tasks', () => void mTasks());

  const nodeList = nodes?.nodes ?? [];
  const appList = apps?.applications ?? [];
  const running = appList.filter((a) => a.status === 'running').length;
  const online = nodeList.filter((n) => n.connected).length;
  const activeTasks = (tasks?.tasks ?? []).filter((t) => t.status === 'running' || t.status === 'queued').length;

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Server} label="Nodes online" value={`${online}/${nodeList.length}`} />
        <Stat icon={Boxes} label="Applications" value={String(appList.length)} />
        <Stat icon={Activity} label="Running" value={String(running)} />
        <Stat icon={ListChecks} label="Active tasks" value={String(activeTasks)} />
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Nodes</h2>
        {nodeList.length === 0 ? (
          <EmptyState title="No nodes yet" hint="Add a node in the Nodes section to start hosting." />
        ) : (
          <div className="space-y-2">
            {nodeList.map((n) => (
              <Link key={n.id} href={`/nodes`} className="flex items-center gap-3 rounded-lg border border-edge p-3 hover:bg-hover">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{n.name}</div>
                  <div className="text-xs text-faint">
                    {n.platform ?? 'unknown'} · {n.cpuCores ?? '?'} cores · {n.totalMemoryMb ? Math.round(n.totalMemoryMb / 1024) + ' GB' : '?'} · {n.applicationCount} apps
                  </div>
                </div>
                {n.lastMetrics && n.connected && (
                  <div className="text-xs text-dim text-right">
                    <div>CPU {Math.round(n.lastMetrics.cpuPercent)}%</div>
                    <div>RAM {Math.round((n.lastMetrics.memoryUsedMb / n.lastMetrics.memoryTotalMb) * 100)}%</div>
                  </div>
                )}
                <StatusBadge status={n.connected ? 'ONLINE' : 'OFFLINE'} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Applications</h2>
        {appList.length === 0 ? (
          <EmptyState title="No applications yet" hint="Create one from the Applications page or ask the AI." />
        ) : (
          <div className="space-y-1.5">
            {appList.slice(0, 8).map((a) => (
              <Link key={a.id} href={`/apps/${a.id}`} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
                <span className="text-sm flex-1 truncate">{a.name}</span>
                <span className="text-xs text-faint">{a.type}</span>
                <span className="text-xs text-faint">{a.node?.name}</span>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-accent/10 grid place-items-center text-accent">
        <Icon size={17} />
      </div>
      <div>
        <div className="text-lg font-semibold leading-tight">{value}</div>
        <div className="text-xs text-dim">{label}</div>
      </div>
    </Card>
  );
}
