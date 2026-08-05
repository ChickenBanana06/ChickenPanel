'use client';

import { use, useEffect, useRef, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Play, Square, RotateCw, Skull, Trash2, Folder, FileText, ArrowLeft, Download, FolderPlus, Pencil, Copy, Eye, EyeOff } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Field, Input, Modal, Spinner, StatusBadge, cx, useToast, ProgressBar } from '@/components/ui';

interface AppDetail {
  id: string; name: string; type: string; status: string;
  node: { id: string; name: string; platform: string | null };
  ports: number[]; env: Record<string, string>; config: Record<string, unknown>;
  restartPolicy: string; lastMetrics: { cpuPercent: number; memoryMb: number; uptimeSeconds: number } | null;
  lastExitCode: number | null;
}

export default function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data, mutate } = useSWR<{ application: AppDetail }>(`/apps/${id}`, fetcher);
  const app = data?.application;
  const [tab, setTab] = useState<'console' | 'files' | 'settings' | 'backups' | 'connection'>('console');
  const [busy, setBusy] = useState<string | null>(null);
  const isDatabase = ['redis', 'postgres', 'mysql'].includes(app?.type ?? '');
  const didInitTab = useRef(false);

  useEffect(() => {
    if (app && isDatabase && !didInitTab.current) {
      didInitTab.current = true;
      setTab('connection');
    }
  }, [app, isDatabase]);

  useRealtimeTopic(`app:${id}`, (evt) => {
    if (evt.event === 'status' || evt.event === 'metrics') void mutate();
  });

  if (!app) {
    return <div className="grid place-items-center h-64"><Spinner /></div>;
  }

  async function action(name: 'start' | 'stop' | 'restart' | 'kill') {
    setBusy(name);
    try {
      await api('POST', `/apps/${id}/${name}`);
      void mutate();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : `${name} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <button className="text-xs text-dim hover:text-ink flex items-center gap-1" onClick={() => router.push('/apps')}>
        <ArrowLeft size={12} /> All applications
      </button>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">{app.name}</h1>
        <StatusBadge status={app.status} />
        <span className="text-xs text-faint">
          {app.type} · {app.node.name} · ports {app.ports.join(', ') || '—'}
        </span>
        {app.status === 'running' && app.lastMetrics && (
          <span className="text-xs text-dim">
            CPU {Math.round(app.lastMetrics.cpuPercent)}% · RAM {Math.round(app.lastMetrics.memoryMb)} MB ·{' '}
            {formatUptime(app.lastMetrics.uptimeSeconds)}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex gap-1.5">
          <Button size="sm" variant="success" disabled={busy !== null || app.status === 'running'} onClick={() => void action('start')} title="Start">
            <Play size={13} />
          </Button>
          <Button size="sm" disabled={busy !== null || app.status !== 'running'} onClick={() => void action('restart')} title="Restart">
            <RotateCw size={13} />
          </Button>
          <Button size="sm" variant="danger" disabled={busy !== null || app.status === 'stopped'} onClick={() => void action('stop')} title="Stop">
            <Square size={13} />
          </Button>
          <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void action('kill')} title="Force kill">
            <Skull size={13} />
          </Button>
          <Button
            size="sm"
            variant="danger"
            title="Delete application"
            onClick={async () => {
              if (!window.confirm(`Delete "${app.name}" and all its files permanently?`)) return;
              try {
                await api('DELETE', `/apps/${id}`);
                toast('info', 'Deletion started');
                router.push('/apps');
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Delete failed');
              }
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-edge">
        {([...(isDatabase ? ['connection'] : []), 'console', 'files', 'settings', 'backups'] as (
          | 'console'
          | 'files'
          | 'settings'
          | 'backups'
          | 'connection'
        )[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              'px-3.5 py-2 text-sm capitalize border-b-2 -mb-px transition-colors',
              tab === t ? 'border-accent text-accent font-medium' : 'border-transparent text-dim hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'connection' && <ConnectionTab app={app} />}
      {tab === 'console' && (
        <ConsoleTab appId={id} running={app.status === 'running'} isMinecraft={app.type === 'minecraft'} />
      )}
      {tab === 'files' && <FilesTab appId={id} />}
      {tab === 'settings' && <SettingsTab app={app} onSaved={() => void mutate()} />}
      {tab === 'backups' && <BackupsTab appId={id} />}
    </div>
  );
}

function formatUptime(s: number): string {
  if (s < 3600) return `${Math.floor(s / 60)}m up`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m up`;
  return `${Math.floor(s / 86400)}d up`;
}

/* ---------------- Connection (databases) ---------------- */

interface ConnectionInfo {
  engine: string; host: string; port: number;
  username: string | null; password: string; database: string | null; uri: string;
}

function ConnectionTab({ app }: { app: AppDetail }) {
  const toast = useToast();
  const [reveal, setReveal] = useState(false);
  const conn = (app.config?.connection ?? null) as ConnectionInfo | null;

  if (!conn) {
    return (
      <Card className="p-4">
        <EmptyState title="No connection info" hint="This database has not finished provisioning yet." />
      </Card>
    );
  }

  // The stored host is node-local; show the browser host as a convenience and
  // build a ready-to-use URI with the real password substituted.
  const host = typeof window !== 'undefined' ? window.location.hostname : conn.host;
  const uri = conn.uri.replace('HOST', host);
  const copy = (v: string) => { void navigator.clipboard.writeText(v); toast('success', 'Copied'); };

  const rows: [string, string, boolean?][] = [
    ['Engine', conn.engine],
    ['Host', host],
    ['Port', String(conn.port)],
    ...(conn.username ? [['Username', conn.username] as [string, string]] : []),
    ...(conn.database ? [['Database', conn.database] as [string, string]] : []),
    ['Password', reveal ? conn.password : '•'.repeat(16), true],
  ];

  return (
    <Card className="p-4 space-y-4 max-w-2xl">
      <div className="grid grid-cols-[110px_1fr_auto] gap-x-3 gap-y-2 items-center text-sm">
        {rows.map(([label, value, secret]) => (
          <Fragment key={label}>
            <span className="text-dim text-xs">{label}</span>
            <span className={cx('console-font truncate', secret && !reveal && 'tracking-widest')}>{value}</span>
            <span className="flex gap-1.5">
              {secret && (
                <button className="text-dim hover:text-ink" onClick={() => setReveal((r) => !r)} title={reveal ? 'Hide' : 'Reveal'}>
                  {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
              <button className="text-dim hover:text-ink" onClick={() => copy(label === 'Password' ? conn.password : value)} title="Copy">
                <Copy size={13} />
              </button>
            </span>
          </Fragment>
        ))}
      </div>

      <div>
        <div className="text-xs text-dim mb-1">Connection URI</div>
        <div className="flex gap-2">
          <code className="console-font text-xs bg-bg border border-edge rounded-lg px-3 py-2 flex-1 overflow-x-auto whitespace-nowrap">
            {reveal ? uri : uri.replace(conn.password, '••••••••')}
          </code>
          <Button size="sm" onClick={() => copy(uri)}><Copy size={13} /></Button>
        </div>
      </div>

      <p className="text-xs text-faint">
        Passwords are generated automatically and stored encrypted with the panel. The host shown is for connecting from
        this machine — from elsewhere on your network use the node&apos;s IP address, and make sure the port is reachable.
      </p>
    </Card>
  );
}

/* ---------------- Console ---------------- */

function ConsoleTab({ appId, running, isMinecraft }: { appId: string; running: boolean; isMinecraft?: boolean }) {
  const toast = useToast();
  const [lines, setLines] = useState<{ stream: string; line: string }[]>([]);
  const [cmd, setCmd] = useState('');
  const [eulaPrompt, setEulaPrompt] = useState(false);
  const [eulaDismissed, setEulaDismissed] = useState(false);
  const [eulaBusy, setEulaBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const EULA_PATTERN = /agree to the eula|eula\.txt/i;

  useEffect(() => {
    if (!isMinecraft || running || eulaDismissed) return;
    if (lines.some((l) => EULA_PATTERN.test(l.line))) setEulaPrompt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, isMinecraft, running, eulaDismissed]);

  async function acceptEula() {
    setEulaBusy(true);
    try {
      await api('PUT', `/apps/${appId}/files/content`, {
        path: 'eula.txt',
        content: '# Accepted by the server owner via ChickenPanel\neula=true\n',
      });
      await api('PATCH', `/apps/${appId}`, { config: { eulaAccepted: true } });
      await api('POST', `/apps/${appId}/start`);
      toast('success', 'EULA accepted — server starting');
      setEulaPrompt(false);
      setEulaDismissed(true);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to accept EULA');
    } finally {
      setEulaBusy(false);
    }
  }

  useEffect(() => {
    void api<{ lines: { stream: string; line: string }[] }>('GET', `/apps/${appId}/logs?lines=300`)
      .then((res) => setLines(res.lines))
      .catch(() => undefined);
  }, [appId]);

  useRealtimeTopic(`app:${appId}:console`, (evt) => {
    if (evt.event === 'log') {
      setLines((l) => [...l.slice(-999), evt.data as { stream: string; line: string }]);
    }
  });

  useEffect(() => {
    if (stickToBottom.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <Card className="overflow-hidden">
      <Modal open={eulaPrompt} onClose={() => { setEulaPrompt(false); setEulaDismissed(true); }} title="Minecraft EULA">
        <div className="space-y-4">
          <p className="text-sm">
            The server stopped because the{' '}
            <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Minecraft End User License Agreement
            </a>{' '}
            has not been accepted yet.
          </p>
          <p className="text-xs text-dim">
            Accepting will set <code className="console-font">eula=true</code> in <code className="console-font">eula.txt</code> and restart the server.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setEulaPrompt(false); setEulaDismissed(true); }}>Not now</Button>
            <Button variant="primary" disabled={eulaBusy} onClick={() => void acceptEula()}>
              {eulaBusy ? 'Accepting…' : 'Agree to EULA & restart'}
            </Button>
          </div>
        </div>
      </Modal>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="console-font text-xs leading-5 bg-bg h-[420px] overflow-y-auto p-3"
      >
        {lines.length === 0 && <p className="text-faint">No output yet.</p>}
        {lines.map((l, i) => (
          <div key={i} className={cx('whitespace-pre-wrap break-all', l.stream === 'stderr' ? 'text-bad/90' : 'text-ink/90')}>
            {l.line}
          </div>
        ))}
      </div>
      <div className="border-t border-edge p-2 flex gap-2">
        <Input
          className="console-font"
          placeholder={running ? 'Type a console command…' : 'Application is not running'}
          value={cmd}
          disabled={!running}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && cmd.trim()) {
              const command = cmd.trim();
              setCmd('');
              try {
                await api('POST', `/apps/${appId}/console`, { command });
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Failed to send');
              }
            }
          }}
        />
      </div>
    </Card>
  );
}

/* ---------------- Files ---------------- */

interface FileEntry { name: string; path: string; type: 'file' | 'directory'; sizeBytes: number; modifiedAt: string }

function FilesTab({ appId }: { appId: string }) {
  const toast = useToast();
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');

  async function load(p: string) {
    setLoading(true);
    try {
      const res = await api<{ entries: FileEntry[] }>('GET', `/apps/${appId}/files?path=${encodeURIComponent(p)}`);
      setEntries(res.entries);
      setPath(p);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to list');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const crumbs = path === '.' ? [] : path.split('/');

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs">
        <button className="text-accent hover:underline" onClick={() => void load('.')}>root</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="text-faint">/</span>
            <button className="text-accent hover:underline" onClick={() => void load(crumbs.slice(0, i + 1).join('/'))}>
              {c}
            </button>
          </span>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setNewFolder(true)}>
          <span className="flex items-center gap-1"><FolderPlus size={12} /> New folder</span>
        </Button>
        {loading && <Spinner className="w-3 h-3" />}
      </div>

      <div className="divide-y divide-edge/50">
        {entries.length === 0 && !loading && <EmptyState title="Empty directory" />}
        {entries.map((e) => (
          <div key={e.path} className="flex items-center gap-2.5 py-1.5 px-1 hover:bg-hover/50 rounded group">
            {e.type === 'directory' ? <Folder size={14} className="text-accent" /> : <FileText size={14} className="text-dim" />}
            <button
              className="text-sm text-left flex-1 truncate hover:text-accent"
              onClick={async () => {
                if (e.type === 'directory') {
                  void load(e.path);
                } else {
                  try {
                    const res = await api<{ content: string; truncated: boolean }>(
                      'GET',
                      `/apps/${appId}/files/content?path=${encodeURIComponent(e.path)}`,
                    );
                    setEditing({ path: e.path, content: res.content, truncated: res.truncated });
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Cannot open file');
                  }
                }
              }}
            >
              {e.name}
            </button>
            <span className="text-xs text-faint w-20 text-right">{e.type === 'file' ? formatSize(e.sizeBytes) : ''}</span>
            <span className="text-xs text-faint w-32 text-right hidden md:block">
              {new Date(e.modifiedAt).toLocaleString()}
            </span>
            <div className="opacity-0 group-hover:opacity-100 flex gap-1">
              <button
                title="Rename"
                className="text-dim hover:text-ink"
                onClick={async () => {
                  const to = window.prompt('New name/path:', e.path);
                  if (!to || to === e.path) return;
                  try {
                    await api('POST', `/apps/${appId}/files/rename`, { from: e.path, to });
                    void load(path);
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Rename failed');
                  }
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                title="Delete"
                className="text-dim hover:text-bad"
                onClick={async () => {
                  if (!window.confirm(`Delete ${e.path}?`)) return;
                  try {
                    await api('POST', `/apps/${appId}/files/delete`, { path: e.path });
                    void load(path);
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Delete failed');
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.path ?? ''} wide>
        {editing && (
          <div className="space-y-3">
            {editing.truncated && <p className="text-xs text-warn">File is large — showing first 2MB (read-only).</p>}
            <textarea
              className="w-full h-96 console-font text-xs bg-bg border border-edge-strong rounded-lg p-3"
              value={editing.content}
              readOnly={editing.truncated}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
            {!editing.truncated && (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={async () => {
                    try {
                      await api('PUT', `/apps/${appId}/files/content`, { path: editing.path, content: editing.content });
                      toast('success', 'Saved');
                      setEditing(null);
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Save failed');
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={newFolder} onClose={() => setNewFolder(false)} title="New folder">
        <div className="space-y-3">
          <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="folder name" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewFolder(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!folderName}
              onClick={async () => {
                try {
                  const p = path === '.' ? folderName : `${path}/${folderName}`;
                  await api('POST', `/apps/${appId}/files/mkdir`, { path: p });
                  setNewFolder(false);
                  setFolderName('');
                  void load(path);
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Failed');
                }
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

/* ---------------- Settings ---------------- */

function SettingsTab({ app, onSaved }: { app: AppDetail; onSaved: () => void }) {
  const toast = useToast();
  const [envText, setEnvText] = useState(
    Object.entries(app.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  );
  const [restartPolicy, setRestartPolicy] = useState(app.restartPolicy);
  const [configText, setConfigText] = useState(JSON.stringify(app.config, null, 2));
  const [busy, setBusy] = useState(false);

  const [portBusy, setPortBusy] = useState(false);

  return (
    <Card className="p-4 space-y-4 max-w-2xl">
      <Field label="Ports">
        <div className="flex items-center gap-2 flex-wrap">
          {app.ports.map((p, i) => (
            <span key={p} className="console-font text-xs bg-raised border border-edge-strong rounded-lg px-2.5 py-1">
              {p} <span className="text-faint">({i === 0 ? 'PORT' : `PORT_${i + 1}`})</span>
            </span>
          ))}
          <Button
            size="sm"
            disabled={portBusy}
            onClick={async () => {
              setPortBusy(true);
              try {
                const res = await api<{ port: number; envVar: string }>('POST', `/apps/${app.id}/ports/allocate`);
                toast('success', `Port ${res.port} allocated as ${res.envVar} — restart to apply`);
                onSaved();
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Allocation failed');
              } finally {
                setPortBusy(false);
              }
            }}
          >
            + Allocate port
          </Button>
        </div>
        <p className="text-xs text-faint mt-1.5">
          Extra ports are passed to the application as PORT_2, PORT_3… environment variables.
        </p>
      </Field>
      <Field label="Restart policy">
        <select
          className="rounded-lg bg-panel border border-edge-strong px-3 py-1.5 text-sm"
          value={restartPolicy}
          onChange={(e) => setRestartPolicy(e.target.value)}
        >
          <option value="never">never</option>
          <option value="on-crash">on-crash</option>
          <option value="always">always</option>
        </select>
      </Field>
      <Field label="Environment variables (KEY=value per line)">
        <textarea
          className="w-full console-font text-xs bg-bg border border-edge-strong rounded-lg p-3 min-h-28"
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
        />
      </Field>
      <Field label={`Configuration (${app.type})`}>
        <textarea
          className="w-full console-font text-xs bg-bg border border-edge-strong rounded-lg p-3 min-h-40"
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
        />
      </Field>
      <p className="text-xs text-faint">Changes apply on the next restart.</p>
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const env: Record<string, string> = {};
            for (const line of envText.split('\n')) {
              const idx = line.indexOf('=');
              if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
            let config: Record<string, unknown> | undefined;
            try {
              config = JSON.parse(configText) as Record<string, unknown>;
            } catch {
              toast('error', 'Configuration is not valid JSON');
              setBusy(false);
              return;
            }
            await api('PATCH', `/apps/${app.id}`, { env, restartPolicy, config });
            toast('success', 'Saved — restart to apply');
            onSaved();
          } catch (err) {
            toast('error', err instanceof Error ? err.message : 'Save failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save changes
      </Button>
    </Card>
  );
}

/* ---------------- Backups ---------------- */

interface BackupRow {
  id: string; name: string; status: string; sizeBytes: number | null; error: string | null; createdAt: string;
}

function BackupsTab({ appId }: { appId: string }) {
  const toast = useToast();
  const { data, mutate } = useSWR<{ backups: BackupRow[] }>(`/backups/app/${appId}`, fetcher);
  useRealtimeTopic('tasks', () => void mutate());
  const backups = data?.backups ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Backups</h3>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            try {
              await api('POST', `/backups/app/${appId}`, {});
              toast('success', 'Backup started');
              void mutate();
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed');
            }
          }}
        >
          <span className="flex items-center gap-1.5"><Download size={13} /> Create backup</span>
        </Button>
      </div>
      {backups.length === 0 ? (
        <EmptyState title="No backups yet" />
      ) : (
        <div className="divide-y divide-edge/50">
          {backups.map((b) => (
            <div key={b.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{b.name}</div>
                <div className="text-xs text-faint">
                  {new Date(b.createdAt).toLocaleString()}
                  {b.sizeBytes !== null && ` · ${formatSize(b.sizeBytes)}`}
                  {b.error && <span className="text-bad"> · {b.error}</span>}
                </div>
              </div>
              <StatusBadge status={b.status} />
              <Button
                size="sm"
                variant="danger"
                disabled={b.status !== 'completed'}
                onClick={async () => {
                  if (!window.confirm('Restore this backup OVER the current files? The app must be stopped.')) return;
                  try {
                    await api('POST', `/backups/${b.id}/restore`);
                    toast('info', 'Restore started');
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Restore failed');
                  }
                }}
              >
                Restore
              </Button>
              <button
                className="text-dim hover:text-bad"
                title="Delete backup"
                onClick={async () => {
                  if (!window.confirm('Delete this backup?')) return;
                  await api('DELETE', `/backups/${b.id}`).catch(() => undefined);
                  void mutate();
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
