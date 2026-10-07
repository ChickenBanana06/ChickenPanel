'use client';

import { use, useEffect, useRef, useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  Play, Square, RotateCw, Skull, Trash2, Folder, FileText, ArrowLeft, Download,
  FolderPlus, Pencil, Copy, Eye, EyeOff, Upload, Users, Sliders, Crown, UserX, Save
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import {
  Button, Card, EmptyState, Field, Input, Select, Modal, ConfirmDialog, Spinner,
  StatusBadge, cx, useToast, ProgressBar
} from '@/components/ui';

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
  const [tab, setTab] = useState<'console' | 'players' | 'config' | 'files' | 'settings' | 'backups' | 'connection'>('console');
  const [busy, setBusy] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isDatabase = ['redis', 'postgres', 'mysql'].includes(app?.type ?? '');
  const isMinecraft = app?.type === 'minecraft';
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

  const tabs: { id: typeof tab; label: string }[] = [
    ...(isDatabase ? [{ id: 'connection' as const, label: 'Connection' }] : []),
    { id: 'console' as const, label: 'Console' },
    ...(isMinecraft ? [
      { id: 'players' as const, label: 'Players' },
      { id: 'config' as const, label: 'Server Config' },
    ] : []),
    { id: 'files' as const, label: 'Files' },
    { id: 'settings' as const, label: 'Settings' },
    { id: 'backups' as const, label: 'Backups' },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      <button className="text-xs text-dim hover:text-ink flex items-center gap-1 cursor-pointer" onClick={() => router.push('/apps')}>
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
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-edge">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'px-3.5 py-2 text-sm capitalize border-b-2 -mb-px transition-colors cursor-pointer',
              tab === t.id ? 'border-accent text-accent font-medium' : 'border-transparent text-dim hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'connection' && <ConnectionTab app={app} />}
      {tab === 'console' && (
        <ConsoleTab appId={id} running={app.status === 'running'} isMinecraft={app.type === 'minecraft'} />
      )}
      {tab === 'players' && <PlayersTab appId={id} running={app.status === 'running'} />}
      {tab === 'config' && <MinecraftConfigTab appId={id} />}
      {tab === 'files' && <FilesTab appId={id} />}
      {tab === 'settings' && <SettingsTab app={app} onSaved={() => void mutate()} />}
      {tab === 'backups' && <BackupsTab appId={id} />}

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api('DELETE', `/apps/${id}`);
            toast('info', 'Deletion started');
            router.push('/apps');
          } catch (err) {
            toast('error', err instanceof Error ? err.message : 'Delete failed');
          } finally {
            setDeleting(false);
            setShowDeleteConfirm(false);
          }
        }}
        title={`Delete "${app.name}"?`}
        message={`Are you sure you want to permanently delete "${app.name}" and all of its files, world data, and configuration? This action cannot be undone.`}
        confirmText="Permanently Delete Server"
        danger
        busy={deleting}
      />
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

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

function FilesTab({ appId }: { appId: string }) {
  const toast = useToast();
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

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

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(',') + 1)); // strip data: prefix
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast('error', `${file.name} is too large (max 64 MB)`);
        continue;
      }
      setUploading(file.name);
      try {
        const base64 = await fileToBase64(file);
        const dest = path === '.' ? file.name : `${path}/${file.name}`;
        await api('PUT', `/apps/${appId}/files/content`, { path: dest, content: base64, base64: true });
        toast('success', `Uploaded ${file.name}`);
      } catch (err) {
        toast('error', `${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      } finally {
        setUploading(null);
      }
    }
    void load(path);
  }

  const crumbs = path === '.' ? [] : path.split('/');

  return (
    <Card
      className={cx('p-4 space-y-3 relative transition-colors', dragOver && 'ring-2 ring-accent bg-accent/5')}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        if (e.dataTransfer.types.includes('Files')) setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {dragOver && (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-bg/80 border-2 border-dashed border-accent pointer-events-none">
          <div className="text-center">
            <Upload className="mx-auto text-accent mb-2" size={28} />
            <p className="text-sm text-accent font-medium">Drop files to upload to /{path === '.' ? '' : path}</p>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />
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
        {uploading && (
          <span className="flex items-center gap-1.5 text-dim">
            <Spinner className="w-3 h-3" /> uploading {uploading}…
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
          <span className="flex items-center gap-1"><Upload size={12} /> Upload</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setNewFolder(true)}>
          <span className="flex items-center gap-1"><FolderPlus size={12} /> New folder</span>
        </Button>
        {loading && <Spinner className="w-3 h-3" />}
      </div>

      <div className="divide-y divide-edge/50">
        {entries.length === 0 && !loading && (
          <EmptyState title="Empty directory" hint="Drag files here or use Upload to add them" />
        )}
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
            <span key={p} className="console-font text-xs bg-raised border border-edge-strong rounded-lg px-2.5 py-1 flex items-center gap-1.5">
              {p} <span className="text-faint">({i === 0 ? 'PORT' : `PORT_${i + 1}`})</span>
              {i > 0 && (
                <button
                  disabled={portBusy}
                  onClick={async () => {
                    if (!window.confirm(`Delete port ${p} from this application?`)) return;
                    setPortBusy(true);
                    try {
                      await api('DELETE', `/apps/${app.id}/ports/${p}`);
                      toast('success', `Port ${p} deleted — restart to apply`);
                      onSaved();
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Delete failed');
                    } finally {
                      setPortBusy(false);
                    }
                  }}
                  className="text-dim hover:text-bad ml-1 font-bold cursor-pointer"
                  title="Delete port"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          <Button
            size="sm"
            disabled={portBusy}
            onClick={async () => {
              const val = window.prompt('Enter preferred port number (leave blank for automatic allocation):');
              if (val === null) return; // user cancelled
              let preferredPort: number | undefined;
              if (val.trim()) {
                const parsed = Number(val.trim());
                if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
                  toast('error', 'Invalid port number');
                  return;
                }
                preferredPort = parsed;
              }
              setPortBusy(true);
              try {
                const res = await api<{ port: number; envVar: string }>(
                  'POST',
                  `/apps/${app.id}/ports/allocate`,
                  preferredPort !== undefined ? { port: preferredPort } : {}
                );
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

/* ---------------- Minecraft Players Tab ---------------- */

function PlayersTab({ appId, running }: { appId: string; running: boolean }) {
  const toast = useToast();
  const [players, setPlayers] = useState<{ name: string; isOp?: boolean; whitelisted?: boolean; online?: boolean }[]>([
    { name: 'Admin', isOp: true, whitelisted: true, online: running },
  ]);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [busy, setBusy] = useState(false);

  async function executeCommand(cmd: string) {
    setBusy(true);
    try {
      await api('POST', `/apps/${appId}/console`, { command: cmd });
      toast('success', `Sent: /${cmd}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Command failed');
    } finally {
      setBusy(false);
    }
  }

  function addPlayer(type: 'whitelist' | 'op') {
    if (!newPlayerName.trim()) return;
    const name = newPlayerName.trim();
    if (!players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setPlayers((prev) => [...prev, { name, isOp: type === 'op', whitelisted: true, online: false }]);
    }
    if (type === 'whitelist') void executeCommand(`whitelist add ${name}`);
    if (type === 'op') void executeCommand(`op ${name}`);
    setNewPlayerName('');
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 mc-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <Users size={16} className="text-emerald-400" />
              <span>Player Management & Whitelist</span>
            </h2>
            <p className="text-xs text-dim">
              Manage operators, whitelist, kicks, and bans directly through the server console.
            </p>
          </div>
          <Button
            size="sm"
            variant="default"
            disabled={!running || busy}
            onClick={() => void executeCommand('list')}
          >
            Refresh (/list)
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={newPlayerName}
            onChange={(e) => setNewPlayerName(e.target.value)}
            placeholder="Minecraft username (e.g. Notch, Steve)..."
            className="flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="default"
            disabled={!newPlayerName.trim() || busy}
            onClick={() => addPlayer('whitelist')}
          >
            Whitelist
          </Button>
          <Button
            size="sm"
            variant="diamond"
            disabled={!newPlayerName.trim() || busy}
            onClick={() => addPlayer('op')}
          >
            Grant OP
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {players.map((p) => (
          <Card key={p.name} className="p-3.5 mc-card flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://mc-heads.net/avatar/${p.name}/44`}
                alt={p.name}
                className="w-10 h-10 rounded-lg bg-raised border border-edge shadow-sm shrink-0"
              />
              <div className="min-w-0">
                <div className="text-sm font-bold text-ink truncate">{p.name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {p.isOp && (
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      OP
                    </span>
                  )}
                  {p.whitelisted && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      Whitelisted
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="default"
                title={p.isOp ? 'Revoke OP' : 'Grant OP'}
                disabled={!running || busy}
                onClick={() => {
                  void executeCommand(p.isOp ? `deop ${p.name}` : `op ${p.name}`);
                  setPlayers((prev) => prev.map((pl) => (pl.name === p.name ? { ...pl, isOp: !pl.isOp } : pl)));
                }}
              >
                <Crown size={12} className={p.isOp ? 'text-amber-400' : 'text-faint'} />
              </Button>
              <Button
                size="xs"
                variant="danger"
                title="Kick Player"
                disabled={!running || busy}
                onClick={() => void executeCommand(`kick ${p.name} Kicked by server administrator`)}
              >
                <UserX size={12} />
              </Button>
              <Button
                size="xs"
                variant="danger"
                title="Ban Player"
                disabled={!running || busy}
                onClick={() => {
                  if (window.confirm(`Ban player "${p.name}"?`)) {
                    void executeCommand(`ban ${p.name} Banned by server administrator`);
                  }
                }}
              >
                Ban
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Minecraft Server Properties Editor ---------------- */

function MinecraftConfigTab({ appId }: { appId: string }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [propsMap, setPropsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    api<{ content: string }>('GET', `/apps/${appId}/files/content?path=server.properties`)
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const line of (res.content ?? '').split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const idx = trimmed.indexOf('=');
          map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
        }
        setPropsMap(map);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  async function saveProps() {
    setSaving(true);
    try {
      const lines = Object.entries(propsMap).map(([k, v]) => `${k}=${v}`);
      const content = `# Minecraft server properties (Managed by ChickenPanel)\n${lines.join('\n')}\n`;
      await api('PUT', `/apps/${appId}/files/content`, { path: 'server.properties', content });
      toast('success', 'server.properties saved! Restart the server to apply changes.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function update(k: string, v: string) {
    setPropsMap((prev) => ({ ...prev, [k]: v }));
  }

  if (loading) {
    return <div className="py-12 text-center"><Spinner /></div>;
  }

  return (
    <Card className="p-5 mc-card space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-edge gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Sliders size={16} className="text-emerald-400" />
            <span>Minecraft Server Properties (`server.properties`)</span>
          </h2>
          <p className="text-xs text-dim">
            Fine-tune core Minecraft server mechanics, view distance, MOTD, and player rules.
          </p>
        </div>
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void saveProps()}>
          <Save size={13} />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <Field label="Server MOTD (Message of the Day)">
          <Input value={propsMap['motd'] ?? ''} onChange={(e) => update('motd', e.target.value)} />
        </Field>
        <Field label="Gamemode">
          <Select value={propsMap['gamemode'] ?? 'survival'} onChange={(e) => update('gamemode', e.target.value)}>
            {['survival', 'creative', 'adventure', 'spectator'].map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Field>
        <Field label="Difficulty">
          <Select value={propsMap['difficulty'] ?? 'normal'} onChange={(e) => update('difficulty', e.target.value)}>
            {['peaceful', 'easy', 'normal', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Max Players">
          <Input type="number" min={1} max={1000} value={propsMap['max-players'] ?? '20'} onChange={(e) => update('max-players', e.target.value)} />
        </Field>
        <Field label="View Distance (Chunks)">
          <Input type="number" min={2} max={32} value={propsMap['view-distance'] ?? '10'} onChange={(e) => update('view-distance', e.target.value)} />
        </Field>
        <Field label="Simulation Distance (Chunks)">
          <Input type="number" min={2} max={32} value={propsMap['simulation-distance'] ?? '8'} onChange={(e) => update('simulation-distance', e.target.value)} />
        </Field>
        <Field label="PVP Enabled">
          <Select value={propsMap['pvp'] ?? 'true'} onChange={(e) => update('pvp', e.target.value)}>
            <option value="true">Enabled (True)</option>
            <option value="false">Disabled (False)</option>
          </Select>
        </Field>
        <Field label="Online Mode (Mojang Authentication)">
          <Select value={propsMap['online-mode'] ?? 'true'} onChange={(e) => update('online-mode', e.target.value)}>
            <option value="true">Enabled (Official accounts only)</option>
            <option value="false">Disabled (Offline / cracked mode)</option>
          </Select>
        </Field>
        <Field label="Whitelist">
          <Select value={propsMap['white-list'] ?? 'false'} onChange={(e) => update('white-list', e.target.value)}>
            <option value="false">Disabled</option>
            <option value="true">Enforced</option>
          </Select>
        </Field>
        <Field label="Hardcore Mode">
          <Select value={propsMap['hardcore'] ?? 'false'} onChange={(e) => update('hardcore', e.target.value)}>
            <option value="false">Disabled</option>
            <option value="true">Enabled (Permadeath)</option>
          </Select>
        </Field>
        <Field label="Spawn Protection Radius">
          <Input type="number" min={0} value={propsMap['spawn-protection'] ?? '16'} onChange={(e) => update('spawn-protection', e.target.value)} />
        </Field>
        <Field label="Allow Flight">
          <Select value={propsMap['allow-flight'] ?? 'false'} onChange={(e) => update('allow-flight', e.target.value)}>
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}
