'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Trash2, KeyRound, Copy, Server, Zap, CheckCircle2, RotateCw, Globe, Terminal } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Field, Input, Modal, StatusBadge, useToast, cx } from '@/components/ui';
import { useAuth } from '@/lib/auth';

interface NodeRow {
  id: string; name: string; description: string | null; status: string; connected: boolean;
  platform: string | null; arch: string | null; osVersion: string | null;
  cpuModel: string | null; cpuCores: number | null;
  totalMemoryMb: number | null; totalDiskMb: number | null;
  agentVersion: string | null; lastHeartbeatAt: string | null;
  applicationCount: number;
  capabilities: { docker: boolean; java: string | null; node: string | null; python: string | null; git: boolean } | null;
  lastMetrics: { cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number; diskUsedMb: number | null; diskTotalMb: number | null } | null;
}

export default function NodesPage() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, mutate } = useSWR<{ nodes: NodeRow[] }>('/nodes', fetcher);
  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState<'local' | 'remote'>('local');
  const [name, setName] = useState('');
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);

  useRealtimeTopic('nodes', () => void mutate());

  const nodes = data?.nodes ?? [];
  const hasConnectedNode = nodes.some((n) => n.connected);
  const createdNode = createdNodeId ? nodes.find((n) => n.id === createdNodeId) : null;
  const isCreatedNodeConnected = Boolean(createdNode?.connected);

  async function handleAutoConnectLocal() {
    setAutoConnecting(true);
    try {
      const res = await api<{ ok: boolean; node: { id: string; name: string }; connected: boolean; message: string }>(
        'POST',
        '/nodes/auto-connect-local',
      );
      toast('success', res.message || 'Local node connected successfully!');
      void mutate();
      setShowAdd(false);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to connect local node');
    } finally {
      setAutoConnecting(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Server size={20} className="text-accent" />
            <span>Nodes & Servers</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Manage machines connected to ChickenPanel that host game servers, bots, and databases.
          </p>
        </div>
        {can('node.manage') && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={autoConnecting}
              onClick={handleAutoConnectLocal}
            >
              <span className="flex items-center gap-1.5">
                {autoConnecting ? <RotateCw size={13} className="animate-spin" /> : <Zap size={13} className="text-accent" />}
                Auto-Connect Local
              </span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setToken(null);
                setCreatedNodeId(null);
                setName('');
                setAddTab(nodes.length === 0 ? 'local' : 'remote');
                setShowAdd(true);
              }}
            >
              <span className="flex items-center gap-1.5"><Plus size={14} /> Add Node</span>
            </Button>
          </div>
        )}
      </div>

      {!hasConnectedNode && can('node.manage') && (
        <div className="p-4 rounded-xl border border-accent/40 bg-accent/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Zap className="text-accent" size={16} />
              <h3 className="text-sm font-semibold text-ink">Host Servers on This Machine</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/20 text-accent">1-Click Setup</span>
            </div>
            <p className="text-xs text-dim leading-relaxed">
              ChickenPanel is installed on this server. Connect this machine as your primary node in 1 click to start deploying Minecraft servers immediately.
            </p>
          </div>
          <Button
            variant="primary"
            disabled={autoConnecting}
            onClick={handleAutoConnectLocal}
          >
            {autoConnecting ? (
              <span className="flex items-center gap-1.5"><RotateCw size={13} className="animate-spin" /> Connecting Agent...</span>
            ) : (
              <span className="flex items-center gap-1.5"><Zap size={13} /> Auto-Connect This Server</span>
            )}
          </Button>
        </div>
      )}

      {nodes.length === 0 ? (
        <Card>
          <EmptyState
            title="No nodes connected yet"
            hint="Connect this server with 1 click or register an external VPS to begin deploying game servers."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {nodes.map((n) => (
            <Card key={n.id} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm text-ink truncate">{n.name}</h3>
                    <StatusBadge status={n.connected ? 'ONLINE' : 'OFFLINE'} />
                  </div>
                  <p className="text-xs text-dim truncate">
                    {n.description ?? `${n.osVersion ?? 'Linux'} · ${n.arch ?? 'x64'}`}
                  </p>
                </div>
                {can('node.manage') && (
                  <button
                    className="text-dim hover:text-bad p-1 rounded transition-colors"
                    title="Delete node"
                    onClick={async () => {
                      if (!window.confirm(`Delete node "${n.name}"?`)) return;
                      try {
                        await api('DELETE', `/nodes/${n.id}`);
                        toast('success', `Node "${n.name}" deleted`);
                        void mutate();
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : 'Delete failed');
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="text-xs text-faint flex items-center justify-between">
                <span>{n.cpuModel ?? 'CPU model unknown'}</span>
                <span>Agent v{n.agentVersion ?? '—'}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Metric label="CPU" value={n.connected && n.lastMetrics ? `${Math.round(n.lastMetrics.cpuPercent)}%` : '—'} />
                <Metric
                  label="Memory"
                  value={
                    n.connected && n.lastMetrics
                      ? `${(n.lastMetrics.memoryUsedMb / 1024).toFixed(1)}/${(n.lastMetrics.memoryTotalMb / 1024).toFixed(0)} GB`
                      : n.totalMemoryMb ? `${Math.round(n.totalMemoryMb / 1024)} GB` : '—'
                  }
                />
                <Metric
                  label="Disk"
                  value={
                    n.connected && n.lastMetrics?.diskTotalMb
                      ? `${Math.round(((n.lastMetrics.diskUsedMb ?? 0) / n.lastMetrics.diskTotalMb) * 100)}%`
                      : '—'
                  }
                />
              </div>

              <div className="flex items-center justify-between text-xs text-faint pt-1 border-t border-edge">
                <span>
                  {n.applicationCount} application{n.applicationCount === 1 ? '' : 's'}
                  {n.capabilities && (
                    <>
                      {' · '}
                      {[
                        n.capabilities.java && 'java',
                        n.capabilities.docker && 'docker',
                        n.capabilities.node && 'node',
                        n.capabilities.git && 'git',
                      ].filter(Boolean).join(', ')}
                    </>
                  )}
                </span>
                {can('node.manage') && (
                  <button
                    className="text-dim hover:text-ink flex items-center gap-1 transition-colors"
                    onClick={async () => {
                      if (!window.confirm('Rotate registration token? The agent will need re-registration.')) return;
                      try {
                        const res = await api<{ registrationToken: string }>('POST', `/nodes/${n.id}/rotate-token`);
                        setToken(res.registrationToken);
                        setName(n.name);
                        setCreatedNodeId(n.id);
                        setAddTab('remote');
                        setShowAdd(true);
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : 'Failed');
                      }
                    }}
                  >
                    <KeyRound size={11} /> Rotate token
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={token ? 'Node Registration & Connection' : 'Add Node'} wide>
        {token ? (
          <TokenInstructions
            name={name}
            token={token}
            isOnline={isCreatedNodeConnected}
            onClose={() => setShowAdd(false)}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex rounded-lg bg-bg p-1 border border-edge">
              <button
                type="button"
                onClick={() => setAddTab('local')}
                className={cx(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5',
                  addTab === 'local' ? 'bg-raised text-ink shadow-sm' : 'text-dim hover:text-ink'
                )}
              >
                <Zap size={13} className="text-accent" />
                This Machine (Local Server)
              </button>
              <button
                type="button"
                onClick={() => setAddTab('remote')}
                className={cx(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5',
                  addTab === 'remote' ? 'bg-raised text-ink shadow-sm' : 'text-dim hover:text-ink'
                )}
              >
                <Globe size={13} />
                Remote VPS / External Node
              </button>
            </div>

            {addTab === 'local' ? (
              <div className="space-y-3 py-2">
                <div className="p-3.5 bg-raised rounded-xl border border-edge text-xs leading-relaxed space-y-2">
                  <div className="font-semibold text-ink flex items-center gap-1.5">
                    <Server size={14} className="text-accent" />
                    Instant Local Node Provisioning
                  </div>
                  <p className="text-dim">
                    Clicking below will automatically create the node entry, configure the local agent credentials, and start the daemon service in the background. No SSH or terminal commands needed.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                  <Button
                    variant="primary"
                    disabled={autoConnecting}
                    onClick={handleAutoConnectLocal}
                  >
                    {autoConnecting ? (
                      <span className="flex items-center gap-1.5"><RotateCw size={13} className="animate-spin" /> Connecting...</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Zap size={13} /> Connect This Server Now</span>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Node Name (e.g. vps-frankfurt or dedicated-node-2)">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vps-germany" autoFocus />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                  <Button
                    variant="primary"
                    disabled={!name}
                    onClick={async () => {
                      try {
                        const res = await api<{ node: { id: string; name: string }; registrationToken: string }>('POST', '/nodes', { name });
                        setToken(res.registrationToken);
                        setCreatedNodeId(res.node.id);
                        void mutate();
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : 'Failed');
                      }
                    }}
                  >
                    Generate Token & Connect
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-raised rounded-lg px-2.5 py-1.5">
      <div className="text-faint">{label}</div>
      <div className="text-ink font-medium">{value}</div>
    </div>
  );
}

function TokenInstructions({
  name,
  token,
  isOnline,
  onClose,
}: {
  name: string;
  token: string;
  isOnline: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const origin = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : '';
  const registerCmd = `chickenpanel node register ${origin} ${token} && chickenpanel start agent`;
  const manualCmd = `cd ~/chickenpanel && node apps/cli/dist/index.js node register ${origin} ${token} && node apps/cli/dist/index.js start agent`;
  const winCmd = `chickenpanel node register ${origin} ${token}; chickenpanel start agent`;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between pb-3 border-b border-edge">
        <div>
          <p className="font-medium text-ink">
            Node: <strong>{name}</strong>
          </p>
          <p className="text-xs text-dim">Registration token generated. Shown once for security.</p>
        </div>
        <div className="flex items-center gap-2">
          {isOnline ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <CheckCircle2 size={13} /> Connected & Online
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Waiting for Agent...
            </span>
          )}
        </div>
      </div>

      <CopyBlock label="Registration token" value={token} onCopy={() => toast('success', 'Token copied')} />

      <div className="space-y-2.5 pt-1">
        <p className="text-xs text-dim font-medium">Run this single command on the target machine in terminal:</p>
        <CopyBlock
          label="Option A: ChickenPanel CLI (Recommended)"
          value={registerCmd}
          onCopy={() => toast('success', 'Command copied')}
        />
        <CopyBlock
          label="Option B: Direct Node.js path (If run from repository checkout)"
          value={manualCmd}
          onCopy={() => toast('success', 'Command copied')}
        />
        <CopyBlock
          label="Option C: Windows PowerShell"
          value={winCmd}
          onCopy={() => toast('success', 'PowerShell command copied')}
        />
      </div>

      {isOnline ? (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center justify-between">
          <span>Success! Agent connected to the panel and is actively reporting telemetry.</span>
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="flex justify-end gap-2 pt-2 border-t border-edge">
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      )}
    </div>
  );
}

function CopyBlock({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div>
      <div className="text-xs text-faint mb-1">{label}</div>
      <div className="flex gap-2">
        <code className="console-font text-xs bg-bg border border-edge rounded-lg px-3 py-2 flex-1 overflow-x-auto whitespace-nowrap">
          {value}
        </code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            onCopy();
          }}
        >
          <Copy size={13} />
        </Button>
      </div>
    </div>
  );
}
