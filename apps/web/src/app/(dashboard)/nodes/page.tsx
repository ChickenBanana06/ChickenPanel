'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Trash2, KeyRound, Copy } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Field, Input, Modal, StatusBadge, useToast } from '@/components/ui';
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
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  useRealtimeTopic('nodes', () => void mutate());

  const nodes = data?.nodes ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Nodes</h1>
        {can('node.manage') && (
          <Button variant="primary" onClick={() => { setToken(null); setName(''); setShowAdd(true); }}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> Add node</span>
          </Button>
        )}
      </div>

      {nodes.length === 0 ? (
        <Card><EmptyState title="No nodes yet" hint="Add a node to connect a machine to the panel." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {nodes.map((n) => (
            <Card key={n.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium flex-1">{n.name}</h3>
                <StatusBadge status={n.connected ? 'ONLINE' : 'OFFLINE'} />
                {can('node.manage') && (
                  <button
                    className="text-dim hover:text-bad"
                    title="Delete node"
                    onClick={async () => {
                      if (!window.confirm(`Delete node "${n.name}"?`)) return;
                      try {
                        await api('DELETE', `/nodes/${n.id}`);
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
              <p className="text-xs text-dim">
                {n.osVersion ?? 'OS unknown'} · {n.arch ?? '?'} · agent {n.agentVersion ?? '—'}
              </p>
              <p className="text-xs text-faint">{n.cpuModel ?? ''}</p>
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
              <p className="text-xs text-faint">
                {n.applicationCount} application(s)
                {n.capabilities && (
                  <>
                    {' · '}
                    {[
                      n.capabilities.java && 'java',
                      n.capabilities.node && 'node',
                      n.capabilities.python && 'python',
                      n.capabilities.docker && 'docker',
                      n.capabilities.git && 'git',
                    ].filter(Boolean).join(', ')}
                  </>
                )}
              </p>
              {can('node.manage') && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!window.confirm('Rotate the registration token? The agent must be reconfigured.')) return;
                    try {
                      const res = await api<{ registrationToken: string }>('POST', `/nodes/${n.id}/rotate-token`);
                      setToken(res.registrationToken);
                      setName(n.name);
                      setShowAdd(true);
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Failed');
                    }
                  }}
                >
                  <span className="flex items-center gap-1"><KeyRound size={12} /> Rotate token</span>
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={token ? 'Connect the agent' : 'Add node'} wide>
        {token ? (
          <TokenInstructions name={name} token={token} />
        ) : (
          <div className="space-y-4">
            <Field label="Node name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vps-1" autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!name}
                onClick={async () => {
                  try {
                    const res = await api<{ registrationToken: string }>('POST', '/nodes', { name });
                    setToken(res.registrationToken);
                    void mutate();
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Failed');
                  }
                }}
              >
                Create
              </Button>
            </div>
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

function TokenInstructions({ name, token }: { name: string; token: string }) {
  const toast = useToast();
  const origin = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4000` : '';
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const registerCmd = `node apps/cli/dist/index.js node register ${origin} ${token}`;
  const startCmd = `node apps/cli/dist/index.js start agent`;

  return (
    <div className="space-y-4 text-sm">
      <p>
        Node <strong>{name}</strong> created. This registration token is shown <strong>once</strong> — store it safely.
      </p>
      <CopyBlock label="Registration token" value={token} onCopy={() => toast('success', 'Copied')} />
      {isLocal && (
        <div className="p-3 bg-bad/10 border border-bad/20 text-bad rounded-lg text-xs leading-relaxed">
          <strong>⚠️ Warning:</strong> You are currently accessing this panel via <code>localhost</code>. 
          If you are registering a remote machine, you <strong>must</strong> replace <code>localhost</code> in the command below 
          with your panel server&apos;s public IP address.
        </div>
      )}
      <div>
        <p className="text-xs text-dim mb-1.5">Run these commands on the target machine inside the project directory:</p>
        <CopyBlock label="1. Register the Node" value={registerCmd} onCopy={() => toast('success', 'Copied')} />
        <div className="mt-2">
          <CopyBlock label="2. Start the Agent" value={startCmd} onCopy={() => toast('success', 'Copied')} />
        </div>
      </div>
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
