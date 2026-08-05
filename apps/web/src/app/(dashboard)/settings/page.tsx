'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, EmptyState, Field, Input, Modal, Select, cx, useToast } from '@/components/ui';

export default function SettingsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'ai' | 'users' | 'audit'>('ai');
  return (
    <div className="space-y-4 max-w-4xl">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="flex gap-1 border-b border-edge">
        {([
          ['ai', 'AI Providers'],
          ['users', 'Users'],
          ['audit', 'Audit log'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cx(
              'px-3.5 py-2 text-sm border-b-2 -mb-px',
              tab === key ? 'border-accent text-accent font-medium' : 'border-transparent text-dim hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'ai' && <AIProviders canConfigure={can('ai.configure')} />}
      {tab === 'users' && (can('users.manage') ? <Users /> : <p className="text-sm text-dim">Requires users.manage permission.</p>)}
      {tab === 'audit' && (can('audit.read') ? <AuditLog /> : <p className="text-sm text-dim">Requires audit.read permission.</p>)}
    </div>
  );
}

/* ---------------- AI Providers ---------------- */

interface ProviderRow {
  id: string; kind: string; displayName: string; baseUrl: string | null; enabled: boolean; apiKeyMasked: string | null;
}

const KIND_PRESETS: Record<string, { label: string; needsBaseUrl: boolean; hint?: string }> = {
  anthropic: { label: 'Anthropic (Claude)', needsBaseUrl: false },
  openai: { label: 'OpenAI (GPT)', needsBaseUrl: false },
  google: { label: 'Google (Gemini)', needsBaseUrl: false },
  'openai-compatible': { label: 'OpenAI-compatible (Ollama, vLLM, OpenRouter…)', needsBaseUrl: true, hint: 'e.g. http://localhost:11434/v1' },
};

function AIProviders({ canConfigure }: { canConfigure: boolean }) {
  const toast = useToast();
  const { data, mutate } = useSWR<{ providers: ProviderRow[] }>('/ai/providers', fetcher);
  const [editing, setEditing] = useState<ProviderRow | 'new' | null>(null);
  const providers = data?.providers ?? [];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-dim">
          API keys are encrypted at rest and never sent back to the browser.
        </p>
        {canConfigure && (
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <span className="flex items-center gap-1"><Plus size={13} /> Add provider</span>
          </Button>
        )}
      </div>
      {providers.length === 0 ? (
        <EmptyState title="No AI providers configured" hint="Add one to enable the AI assistant." />
      ) : (
        <div className="divide-y divide-edge/50">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm">{p.displayName}</div>
                <div className="text-xs text-faint">
                  {KIND_PRESETS[p.kind]?.label ?? p.kind}
                  {p.baseUrl && ` · ${p.baseUrl}`}
                  {p.apiKeyMasked && ` · key ${p.apiKeyMasked}`}
                </div>
              </div>
              <span className={cx('text-xs', p.enabled ? 'text-ok' : 'text-faint')}>{p.enabled ? 'enabled' : 'disabled'}</span>
              {canConfigure && (
                <>
                  <button className="text-dim hover:text-ink" onClick={() => setEditing(p)}><Pencil size={13} /></button>
                  <button
                    className="text-dim hover:text-bad"
                    onClick={async () => {
                      if (!window.confirm(`Delete provider "${p.displayName}"?`)) return;
                      try {
                        await api('DELETE', `/ai/providers/${p.id}`);
                        void mutate();
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : 'Delete failed');
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <ProviderModal
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void mutate(); }}
      />
    </Card>
  );
}

function ProviderModal({
  editing, onClose, onSaved,
}: {
  editing: ProviderRow | 'new' | null; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const isNew = editing === 'new';
  const existing = editing !== null && editing !== 'new' ? editing : null;
  const [kind, setKind] = useState(existing?.kind ?? 'anthropic');
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  // Re-sync when target changes
  const key = existing?.id ?? (isNew ? 'new' : 'none');
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setKind(existing?.kind ?? 'anthropic');
    setDisplayName(existing?.displayName ?? '');
    setApiKey('');
    setBaseUrl(existing?.baseUrl ?? '');
    setEnabled(existing?.enabled ?? true);
  }

  const preset = KIND_PRESETS[kind];

  return (
    <Modal open={editing !== null} onClose={onClose} title={isNew ? 'Add AI provider' : 'Edit AI provider'}>
      <div className="space-y-3">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} disabled={!isNew}>
            {Object.entries(KIND_PRESETS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Claude" />
        </Field>
        <Field label={isNew ? 'API key' : 'API key (leave blank to keep current)'}>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        {(preset?.needsBaseUrl || baseUrl) && (
          <Field label="Base URL">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={preset?.hint} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !displayName || (isNew && !apiKey && kind !== 'openai-compatible')}
            onClick={async () => {
              setBusy(true);
              try {
                const body = {
                  kind, displayName, enabled,
                  ...(apiKey ? { apiKey } : {}),
                  ...(baseUrl ? { baseUrl } : { baseUrl: null }),
                };
                if (isNew) await api('POST', '/ai/providers', body);
                else await api('PATCH', `/ai/providers/${existing!.id}`, body);
                toast('success', 'Provider saved');
                onSaved();
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Save failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Users ---------------- */

interface UserRow {
  id: string; username: string; email: string; role: string;
  grantedPermissions: string[]; revokedPermissions: string[]; createdAt: string;
}

function Users() {
  const toast = useToast();
  const { data, mutate } = useSWR<{ users: UserRow[] }>('/users', fetcher);
  const users = data?.users ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('USER');
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={() => setShowAdd(true)}>
          <span className="flex items-center gap-1"><Plus size={13} /> Add user</span>
        </Button>
      </div>
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add user">
        <div className="space-y-3">
          <Field label="Username">
            <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoFocus placeholder="steve" />
          </Field>
          <Field label="Password (min 8 characters)">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Field label="Email (optional)">
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="steve@example.com" />
          </Field>
          <Field label="Role">
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option>USER</option>
              <option>ADMIN</option>
              <option>VIEWER</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || newUsername.length < 3 || newPassword.length < 8}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('POST', '/users', {
                    username: newUsername,
                    password: newPassword,
                    ...(newEmail ? { email: newEmail } : {}),
                    role: newRole,
                  });
                  toast('success', `User ${newUsername} created`);
                  setShowAdd(false);
                  setNewUsername(''); setNewPassword(''); setNewEmail(''); setNewRole('USER');
                  void mutate();
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Create failed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create user
            </Button>
          </div>
        </div>
      </Modal>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint border-b border-edge">
            <th className="py-2 font-medium">User</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-edge/50 last:border-0">
              <td className="py-2.5">{u.username}</td>
              <td className="py-2.5 text-dim">{u.email}</td>
              <td className="py-2.5">
                <Select
                  className="w-28"
                  value={u.role}
                  onChange={async (e) => {
                    try {
                      await api('PATCH', `/users/${u.id}`, { role: e.target.value });
                      void mutate();
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Failed');
                    }
                  }}
                >
                  <option>ADMIN</option>
                  <option>USER</option>
                  <option>VIEWER</option>
                </Select>
              </td>
              <td className="py-2.5 text-right">
                <button
                  className="text-dim hover:text-bad"
                  onClick={async () => {
                    if (!window.confirm(`Delete user ${u.username}?`)) return;
                    try {
                      await api('DELETE', `/users/${u.id}`);
                      void mutate();
                    } catch (err) {
                      toast('error', err instanceof Error ? err.message : 'Failed');
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------- Audit log ---------------- */

interface AuditRow {
  id: string; actor: string; action: string; targetType: string | null; targetId: string | null;
  success: boolean; error: string | null; createdAt: string;
  user: { username: string } | null;
}

function AuditLog() {
  const { data } = useSWR<{ logs: AuditRow[] }>('/audit?limit=100', fetcher, { refreshInterval: 10000 });
  const logs = data?.logs ?? [];
  return (
    <Card className="p-4">
      {logs.length === 0 ? (
        <EmptyState title="No audit entries yet" />
      ) : (
        <div className="divide-y divide-edge/50 text-xs">
          {logs.map((l) => (
            <div key={l.id} className="py-2 flex items-center gap-3">
              <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', l.success ? 'bg-ok' : 'bg-bad')} />
              <span className="console-font text-dim">{l.action}</span>
              <span className="text-faint flex-1 truncate">
                {l.actor === 'ai' ? '🤖 AI' : l.user?.username ?? l.actor}
                {l.targetType && ` → ${l.targetType}`}
                {l.error && ` — ${l.error.slice(0, 80)}`}
              </span>
              <span className="text-faint whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
