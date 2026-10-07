'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Plus, Send, Square, ChevronDown, ChevronRight, Wrench,
  Check, XIcon, AlertTriangle, Trash2, MessageSquare,
  Paperclip, Shield, Zap, Lock, FileText, X, History, Sparkles,
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { useTypewriter } from '@/lib/typewriter';
import { Button, Input, Select, Spinner, cx, useToast, StatusBadge } from '../ui';

/* ---------------- Types mirrored from the API ---------------- */

interface Conversation {
  id: string;
  name: string;
  model: string;
  state: string;
  autonomyLevel?: 'full' | 'moderate' | 'none';
  provider?: { displayName: string; kind: string };
  updatedAt: string;
}

interface Message {
  id: string;
  role: string;
  parts: Part[];
  createdAt: string;
}

type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; toolCallId: string; name: string; args: unknown; status: string; result?: unknown; error?: string }
  | { type: 'ui'; component: UIComponent; response?: unknown }
  | { type: 'plan'; plan: Plan }
  | { type: 'tool_result'; toolCallId: string; content: string };

interface UIComponent {
  kind: string;
  id: string;
  prompt: string;
  options?: { label: string; value: string }[];
  multi?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  fields?: { name: string; label: string; type: string; options?: string[]; required?: boolean }[];
}

interface Plan {
  id: string;
  title: string;
  status: string;
  steps: { id: string; title: string; detail?: string; status: string }[];
}

const STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_input: 'Waiting for you',
  waiting_approval: 'Needs approval',
  cancelled: 'Cancelled',
  errored: 'Error',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return '';
  }
}

/* ---------------- Panel ---------------- */

export function AIPanel({ onClose: _onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chickenpanel_ai_active_conv');
    }
    return null;
  });
  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('chickenpanel_ai_active_conv', id);
      else localStorage.removeItem('chickenpanel_ai_active_conv');
    }
  }, []);

  const [showList, setShowList] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const { data: convData, mutate: mutateConvs } = useSWR<{ conversations: Conversation[] }>(
    '/ai/conversations',
    fetcher,
    { revalidateOnFocus: false },
  );
  const conversations = useMemo(() => convData?.conversations ?? [], [convData]);
  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (conversations.length > 0) {
      if (!activeId || !conversations.some((c) => c.id === activeId)) {
        setActiveId(conversations[0]!.id);
      }
    } else if (activeId) {
      setActiveId(null);
    }
  }, [conversations, activeId, setActiveId]);

  return (
    <aside className="w-[380px] shrink-0 border-l border-edge flex flex-col bg-panel/40">
      {/* Header */}
      <div className="h-12 border-b border-edge flex items-center px-3 gap-2 shrink-0 bg-panel/70">
        <button
          className={cx(
            'p-1.5 rounded-lg border transition-colors flex items-center gap-1.5 text-xs',
            showList ? 'bg-accent/15 border-accent text-ink' : 'border-edge hover:bg-hover text-dim hover:text-ink',
          )}
          title="Past Conversations"
          onClick={() => {
            setShowList((v) => !v);
            setShowNew(false);
          }}
        >
          <History size={14} />
          <span className="font-medium text-xs">Chats</span>
          <ChevronDown size={12} className={cx('transition-transform duration-150', showList && 'rotate-180')} />
        </button>

        <div className="flex-1 min-w-0 px-1">
          {active ? (
            <div className="truncate text-xs font-semibold text-ink" title={active.name}>
              {active.name}
            </div>
          ) : (
            <div className="text-xs font-medium text-dim">Cluck AI</div>
          )}
          {active && (
            <div className="text-[10px] text-faint truncate">
              {active.provider?.displayName} · {STATE_LABELS[active.state] ?? active.state}
            </div>
          )}
        </div>

        <button
          className="p-1.5 rounded-lg border border-edge hover:bg-hover text-dim hover:text-ink transition-colors flex items-center gap-1 text-xs shrink-0"
          title="New conversation"
          onClick={() => {
            setShowNew(true);
            setShowList(false);
          }}
        >
          <Plus size={14} />
          <span>New</span>
        </button>
      </div>

      {showList && (
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setShowList(false);
          }}
          onDeleted={(id) => {
            if (activeId === id) setActiveId(null);
            void mutateConvs();
          }}
        />
      )}

      {showNew ? (
        <NewConversation
          onCreated={(id) => {
            setShowNew(false);
            void mutateConvs();
            setActiveId(id);
          }}
          onCancel={() => setShowNew(false)}
        />
      ) : active ? (
        <Chat key={active.id} conversation={active} onStateChange={() => void mutateConvs()} />
      ) : (
        <div className="flex-1 grid place-items-center p-6 text-center">
          <div>
            <MessageSquare className="mx-auto text-faint mb-3" size={28} />
            <p className="text-sm text-dim mb-3">No conversations yet.</p>
            <Button variant="primary" onClick={() => setShowNew(true)}>
              Start a conversation
            </Button>
            <p className="text-xs text-faint mt-3">
              Configure AI providers in Settings first if you haven&apos;t.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ---------------- Conversation list ---------------- */

function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDeleted,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    if (!filter.trim()) return conversations;
    const q = filter.toLowerCase();
    return conversations.filter(
      (c) => c.name.toLowerCase().includes(q) || c.model.toLowerCase().includes(q),
    );
  }, [conversations, filter]);

  return (
    <div className="border-b border-edge max-h-72 overflow-y-auto bg-raised/30 divide-y divide-edge/30">
      <div className="p-2 sticky top-0 bg-panel/95 backdrop-blur z-10 border-b border-edge">
        <Input
          placeholder="Filter conversations…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {filtered.length === 0 && (
        <p className="text-xs text-faint p-4 text-center">No conversations found.</p>
      )}
      {filtered.map((c) => (
        <div
          key={c.id}
          className={cx(
            'flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors',
            c.id === activeId ? 'bg-accent/15 border-l-2 border-accent' : 'hover:bg-hover',
          )}
          onClick={() => onSelect(c.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-ink truncate">{c.name}</div>
            <div className="text-[10px] text-faint flex items-center gap-2 mt-0.5">
              <span>{c.provider?.displayName ?? 'AI'} · {c.model.split('/').pop()}</span>
              {c.updatedAt && <span>{formatRelativeTime(c.updatedAt)}</span>}
            </div>
          </div>
          <span
            className={cx(
              'text-[10px] shrink-0',
              c.state === 'running' && 'text-ok',
              (c.state === 'waiting_input' || c.state === 'waiting_approval') && 'text-warn',
              c.state === 'errored' && 'text-bad',
            )}
          >
            {c.state === 'running' ? '🟢' : c.state === 'waiting_input' || c.state === 'waiting_approval' ? '⏸' : ''}
          </span>
          <button
            className="text-faint hover:text-bad p-1 rounded hover:bg-bad/10 shrink-0 transition-colors"
            title="Delete conversation"
            onClick={async (e) => {
              e.stopPropagation();
              if (!window.confirm(`Delete conversation "${c.name}"?`)) return;
              try {
                await api('DELETE', `/ai/conversations/${c.id}`);
                onDeleted(c.id);
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Delete failed');
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- New conversation ---------------- */

function NewConversation({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const { data: provData } = useSWR<{ providers: { id: string; displayName: string; enabled: boolean }[] }>(
    '/ai/providers',
    fetcher,
  );
  const providers = (provData?.providers ?? []).filter((p) => p.enabled);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [name, setName] = useState('');
  const [autonomyLevel, setAutonomyLevel] = useState<'full' | 'moderate' | 'none'>('moderate');
  const [busy, setBusy] = useState(false);
  const effectiveProvider = providerId || providers[0]?.id || '';

  const { data: modelData, isLoading: modelsLoading, error: modelsError } = useSWR<{ models: { id: string; displayName: string }[] }>(
    effectiveProvider ? `/ai/providers/${effectiveProvider}/models` : null,
    fetcher,
    { shouldRetryOnError: false },
  );
  const models = modelData?.models ?? [];
  const effectiveModel = model || models[0]?.id || '';

  return (
    <div className="p-4 space-y-3 border-b border-edge bg-raised/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 text-ink">
          <Sparkles size={14} className="text-accent" /> Start New Conversation
        </h3>
        <button onClick={onCancel} className="text-faint hover:text-dim"><X size={14} /></button>
      </div>
      {providers.length === 0 ? (
        <p className="text-xs text-warn">
          No AI providers configured. Add one in Settings → AI Providers.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-[11px] text-faint">AI Provider</label>
            <Select value={effectiveProvider} onChange={(e) => { setProviderId(e.target.value); setModel(''); }}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-faint">Model</label>
            <Select value={effectiveModel} onChange={(e) => setModel(e.target.value)} disabled={modelsLoading}>
              {modelsLoading && <option>Loading models…</option>}
              {!modelsLoading && models.length === 0 && <option value="">No models available</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </Select>
            {modelsError && (
              <p className="text-[11px] text-bad mt-1">Failed to fetch models: Check API key in Settings.</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-faint">Access Level</label>
            <div className="grid grid-cols-3 gap-1 pt-0.5">
              <button
                type="button"
                onClick={() => setAutonomyLevel('full')}
                className={cx(
                  'p-1.5 rounded-lg border text-center text-xs flex flex-col items-center gap-0.5 transition-all',
                  autonomyLevel === 'full' ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 font-semibold' : 'border-edge hover:bg-hover text-dim',
                )}
              >
                <Zap size={13} className="text-emerald-400" />
                <span className="text-[10px]">Full</span>
              </button>
              <button
                type="button"
                onClick={() => setAutonomyLevel('moderate')}
                className={cx(
                  'p-1.5 rounded-lg border text-center text-xs flex flex-col items-center gap-0.5 transition-all',
                  autonomyLevel === 'moderate' ? 'bg-amber-500/15 border-amber-500 text-amber-300 font-semibold' : 'border-edge hover:bg-hover text-dim',
                )}
              >
                <Shield size={13} className="text-amber-400" />
                <span className="text-[10px]">Moderate</span>
              </button>
              <button
                type="button"
                onClick={() => setAutonomyLevel('none')}
                className={cx(
                  'p-1.5 rounded-lg border text-center text-xs flex flex-col items-center gap-0.5 transition-all',
                  autonomyLevel === 'none' ? 'bg-sky-500/15 border-sky-500 text-sky-300 font-semibold' : 'border-edge hover:bg-hover text-dim',
                )}
              >
                <Lock size={13} className="text-sky-400" />
                <span className="text-[10px]">No access</span>
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-faint">Conversation Name <span className="text-faint/60">(optional)</span></label>
            <Input
              placeholder="Auto-generated from your first message"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !effectiveProvider || !effectiveModel}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await api<{ conversation: { id: string } }>('POST', '/ai/conversations', {
                name: name.trim() || 'New Chat',
                providerId: effectiveProvider,
                model: effectiveModel,
                autonomyLevel,
              });
              onCreated(res.conversation.id);
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed to create');
            } finally {
              setBusy(false);
            }
          }}
        >
          Start Conversation
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Chat ---------------- */

function Chat({ conversation, onStateChange }: { conversation: Conversation; onStateChange: () => void }) {
  const toast = useToast();
  const convId = conversation.id;
  const { data, mutate } = useSWR<{ conversation: Conversation; messages: Message[] }>(
    `/ai/conversations/${convId}/messages`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const messages = useMemo(() => data?.messages ?? [], [data]);
  const state = data?.conversation.state ?? conversation.state;
  const [autonomy, setAutonomy] = useState<'full' | 'moderate' | 'none'>(
    conversation.autonomyLevel ?? 'moderate',
  );

  useEffect(() => {
    if (data?.conversation?.autonomyLevel) {
      setAutonomy(data.conversation.autonomyLevel);
    }
  }, [data?.conversation?.autonomyLevel]);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<{ name: string; size: number; content: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typewriter = useTypewriter();
  const streamText = typewriter.displayed;
  const refetch = useCallback(() => {
    void mutate();
    onStateChange();
  }, [mutate, onStateChange]);

  useRealtimeTopic(`chat:${convId}`, (evt) => {
    if (evt.event === 'stream.text') {
      typewriter.push((evt.data as { delta: string }).delta);
    } else if (['message.assistant', 'run.done', 'run.error'].includes(evt.event)) {
      typewriter.finish(() => {
        typewriter.reset();
        refetch();
      });
    } else if (
      ['ui.ask', 'plan.proposed', 'tool.awaiting_approval', 'tool.finished', 'state', 'conversation.updated'].includes(evt.event)
    ) {
      refetch();
    }
  });

  useEffect(() => {
    typewriter.reset();
    setAttachments([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText]);

  async function updateAutonomy(level: 'full' | 'moderate' | 'none') {
    setAutonomy(level);
    try {
      await api('PATCH', `/ai/conversations/${convId}`, { autonomyLevel: level });
      refetch();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to update access mode');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        toast('error', `File ${file.name} is too large (> 2MB).`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        let text = (ev.target?.result as string) || '';
        if (text.length > 100000) {
          const lines = text.split('\n');
          if (lines.length > 400) {
            text = `[... truncated, showing last 400 lines ...]\n` + lines.slice(-400).join('\n');
          }
        }
        setAttachments((prev) => [...prev, { name: file.name, size: file.size, content: text }]);
      };
      reader.onerror = () => {
        toast('error', `Could not read ${file.name}`);
      };
      reader.readAsText(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  async function send() {
    let content = input.trim();
    if (!content && attachments.length === 0) return;

    if (attachments.length > 0) {
      const fileBlocks = attachments
        .map((att) => {
          const ext = att.name.split('.').pop() || 'text';
          return `[Attached file: ${att.name} (${formatSize(att.size)})]\n\`\`\`${ext}\n${att.content}\n\`\`\``;
        })
        .join('\n\n');
      content = content ? `${fileBlocks}\n\n${content}` : fileBlocks;
    }

    setInput('');
    setAttachments([]);
    setBusy(true);
    try {
      await api('POST', `/ai/conversations/${convId}/messages`, { content });
      refetch();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Send failed');
      setInput(input);
    } finally {
      setBusy(false);
    }
  }

  const running = state === 'running';

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streamText && (
          <div className="space-y-4 my-6 px-1">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center text-accent mx-auto text-lg shadow-sm">
                🐤
              </div>
              <h3 className="text-sm font-bold text-ink">Cluck AI Server Engineer</h3>
              <p className="text-xs text-dim">
                Ask questions, troubleshoot crashes, edit configs, or deploy servers.
              </p>
            </div>

            <div className="space-y-1.5 pt-2">
              <div className="text-[10px] uppercase font-bold text-faint tracking-wider px-1">
                Quick Prompts
              </div>
              {[
                '🔍 Diagnose recent server logs or crashes',
                '🚀 Optimize JVM flags for a 4GB Paper server',
                '🛡️ Audit server security and open ports',
                '📦 How do I configure a Velocity proxy network?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setInput(suggestion.slice(3))}
                  className="w-full text-left p-2 rounded-lg bg-raised hover:bg-hover border border-edge text-xs text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} convId={convId} onAction={refetch} />
        ))}
        {streamText && (
          <div className="text-[13px] whitespace-pre-wrap leading-relaxed bg-raised/60 rounded-lg px-3 py-2 border border-edge">
            {streamText}
            <span className="inline-block w-1.5 h-3.5 bg-accent ml-0.5 animate-pulse align-middle" />
          </div>
        )}
        {running && !streamText && (
          <div className="flex items-center gap-2 text-xs text-dim px-1">
            <Spinner className="w-3 h-3" /> working…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-edge p-3 shrink-0 space-y-2.5 bg-panel/30">
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-0.5 max-h-24 overflow-y-auto">
            {attachments.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 bg-raised border border-edge rounded-md px-2 py-1 text-xs text-ink"
              >
                <FileText size={12} className="text-accent" />
                <span className="truncate max-w-[120px]" title={att.name}>{att.name}</span>
                <span className="text-[10px] text-faint">({formatSize(att.size)})</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="text-faint hover:text-bad ml-0.5"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-center gap-1.5">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            className="hidden"
            onChange={handleFileSelect}
            accept=".txt,.log,.yml,.yaml,.json,.properties,.toml,.conf,.cfg,.sh,.bat,.md,.env,.xml,.sql"
          />
          <button
            type="button"
            title="Attach file for AI to read (.log, .properties, .yml...)"
            disabled={busy || running}
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-dim hover:text-accent rounded-lg hover:bg-raised transition-colors shrink-0 disabled:opacity-50"
          >
            <Paperclip size={16} />
          </button>
          <Input
            className="flex-1"
            placeholder={running ? 'Agent is working…' : 'Message the AI or attach logs/configs…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={busy || running}
          />
          {running ? (
            <Button
              variant="danger"
              title="Cancel run"
              onClick={async () => {
                await api('POST', `/ai/conversations/${convId}/cancel`).catch(() => undefined);
                refetch();
              }}
            >
              <Square size={14} />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void send()} disabled={busy || (!input.trim() && attachments.length === 0)}>
              <Send size={14} />
            </Button>
          )}
        </div>

        {/* Autonomy Level Switcher */}
        <div className="flex items-center justify-between pt-1 border-t border-edge/40 text-[11px]">
          <span className="text-faint flex items-center gap-1">
            Access mode:
          </span>
          <div className="inline-flex rounded-lg bg-raised p-0.5 border border-edge text-[11px]">
            <button
              type="button"
              onClick={() => updateAutonomy('full')}
              title="Full access: AI executes tasks without asking for approval"
              className={cx(
                'px-2 py-0.5 rounded flex items-center gap-1 transition-all',
                autonomy === 'full'
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm border border-emerald-500/30'
                  : 'text-dim hover:text-ink',
              )}
            >
              <Zap size={11} className={autonomy === 'full' ? 'text-emerald-400' : ''} />
              <span>Full access</span>
            </button>
            <button
              type="button"
              onClick={() => updateAutonomy('moderate')}
              title="Moderate access: AI asks approval for dangerous actions only (commands, deletes)"
              className={cx(
                'px-2 py-0.5 rounded flex items-center gap-1 transition-all',
                autonomy === 'moderate'
                  ? 'bg-amber-500/20 text-amber-300 font-semibold shadow-sm border border-amber-500/30'
                  : 'text-dim hover:text-ink',
              )}
            >
              <Shield size={11} className={autonomy === 'moderate' ? 'text-amber-400' : ''} />
              <span>Moderate</span>
            </button>
            <button
              type="button"
              onClick={() => updateAutonomy('none')}
              title="No access: AI requires approval before executing ANY task"
              className={cx(
                'px-2 py-0.5 rounded flex items-center gap-1 transition-all',
                autonomy === 'none'
                  ? 'bg-sky-500/20 text-sky-300 font-semibold shadow-sm border border-sky-500/30'
                  : 'text-dim hover:text-ink',
              )}
            >
              <Lock size={11} className={autonomy === 'none' ? 'text-sky-400' : ''} />
              <span>No access</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------- Message rendering ---------------- */

function MessageView({ message, convId, onAction }: { message: Message; convId: string; onAction: () => void }) {
  if (message.role === 'tool') return null; // raw tool results are shown via their tool_call chip
  const isUser = message.role === 'user';
  return (
    <div className={cx('space-y-1.5', isUser && 'flex flex-col items-end')}>
      {message.parts.map((part, i) => (
        <PartView key={i} part={part} message={message} convId={convId} onAction={onAction} isUser={isUser} />
      ))}
    </div>
  );
}

function PartView({
  part,
  message,
  convId,
  onAction,
  isUser,
}: {
  part: Part;
  message: Message;
  convId: string;
  onAction: () => void;
  isUser: boolean;
}) {
  const toast = useToast();
  if (part.type === 'text') {
    return (
      <div
        className={cx(
          'text-[13px] whitespace-pre-wrap leading-relaxed rounded-lg px-3 py-2 max-w-full break-words',
          isUser ? 'bg-accent-strong/25 border border-accent/30' : 'bg-raised/60 border border-edge',
        )}
      >
        {part.text}
      </div>
    );
  }
  if (part.type === 'thinking') return <ThinkingView text={part.text} />;
  if (part.type === 'tool_call') return <ToolCallChip part={part} convId={convId} onAction={onAction} />;
  if (part.type === 'ui') {
    return <UIComponentView component={part.component} response={part.response} messageId={message.id} convId={convId} onAction={onAction} />;
  }
  if (part.type === 'plan') return <PlanCard plan={part.plan} messageId={message.id} convId={convId} onAction={onAction} />;
  return null;
}

function ThinkingView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button className="text-faint hover:text-dim flex items-center gap-1" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} thinking
      </button>
      {open && <p className="text-faint whitespace-pre-wrap mt-1 pl-4 border-l border-edge">{text}</p>}
    </div>
  );
}

function ToolCallChip({
  part,
  convId,
  onAction,
}: {
  part: Extract<Part, { type: 'tool_call' }>;
  convId: string;
  onAction: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const statusIcon =
    part.status === 'succeeded' ? <Check size={12} className="text-ok" /> :
    part.status === 'failed' || part.status === 'denied' ? <XIcon size={12} className="text-bad" /> :
    part.status === 'awaiting_approval' ? <AlertTriangle size={12} className="text-warn" /> :
    <Spinner className="w-3 h-3" />;

  return (
    <div className="border border-edge rounded-lg bg-panel/80 text-xs">
      <button className="flex items-center gap-2 px-2.5 py-1.5 w-full text-left" onClick={() => setOpen((v) => !v)}>
        <Wrench size={12} className="text-dim shrink-0" />
        <span className="font-mono text-dim truncate flex-1">{part.name}</span>
        {statusIcon}
      </button>
      {part.status === 'awaiting_approval' && (
        <div className="p-3 bg-red-950/25 border-t border-bad/30 space-y-2.5">
          <div className="flex items-start gap-2 text-bad">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-xs uppercase tracking-wide">
                Security Approval Required
              </div>
              <p className="text-[11px] text-dim mt-0.5">
                The AI operator is requesting to perform a restricted action: <code className="text-ink font-bold font-mono px-1 py-0.2 rounded bg-raised border border-edge">{part.name}</code>.
              </p>
            </div>
          </div>
          <div className="bg-bg/90 rounded-lg p-2.5 border border-edge text-[11px] space-y-1">
            <span className="text-faint block font-semibold uppercase text-[10px]">Parameters:</span>
            <pre className="console-font text-[10px] text-amber-200/90 overflow-x-auto max-h-32">
              {JSON.stringify(part.args, null, 2)}
            </pre>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" variant="danger" onClick={() => approve(false)}>
              Deny
            </Button>
            <Button size="sm" variant="success" onClick={() => approve(true)}>
              Authorize Action
            </Button>
          </div>
        </div>
      )}
      {open && (
        <div className="px-2.5 pb-2 space-y-1">
          <JsonBlock label="args" value={part.args} />
          {part.result !== undefined && <JsonBlock label="result" value={part.result} />}
          {part.error && <p className="text-bad">{part.error}</p>}
        </div>
      )}
    </div>
  );

  async function approve(ok: boolean) {
    try {
      await api('POST', `/ai/conversations/${convId}/approve-tool`, { toolCallId: part.toolCallId, approve: ok });
      onAction();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed');
    }
  }
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <span className="text-faint">{label}:</span>
      <pre className="console-font text-[10px] text-dim bg-bg rounded p-1.5 mt-0.5 overflow-x-auto max-h-40">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/* ---------------- Interactive UI components ---------------- */

function UIComponentView({
  component,
  response,
  messageId,
  convId,
  onAction,
}: {
  component: UIComponent;
  response?: unknown;
  messageId: string;
  convId: string;
  onAction: () => void;
}) {
  const toast = useToast();
  const answered = response !== undefined;
  const [value, setValue] = useState<unknown>(component.kind === 'slider' ? component.min ?? 0 : '');
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [formState, setFormState] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  async function submit(v: unknown) {
    setBusy(true);
    try {
      await api('POST', `/ai/conversations/${convId}/ui-response`, { messageId, componentId: component.id, value: v });
      onAction();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-accent/30 bg-accent/5 rounded-lg p-3 space-y-2.5">
      <p className="text-[13px]">{component.prompt}</p>
      {answered ? (
        <div className="text-xs text-emerald-400 bg-emerald-950/30 border border-emerald-500/30 rounded-md px-2.5 py-1.5 flex items-center gap-2">
          <Check size={14} className="text-emerald-400 shrink-0" />
          <span className="text-faint">Answered:</span>
          <span className="font-semibold text-emerald-300">{formatResponse(response)}</span>
        </div>
      ) : (
        <>
          {component.kind === 'buttons' && (
            <div className="flex flex-wrap gap-2 pt-1">
              {component.options?.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={busy}
                  onClick={() => void submit(o.value)}
                  className="px-3 py-1.5 rounded-lg bg-raised hover:bg-accent hover:text-white border border-edge hover:border-accent text-xs font-medium text-ink transition-all shadow-sm active:scale-95 disabled:opacity-50 text-left flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
          )}
          {component.kind === 'confirm' && (
            <div className="flex gap-2">
              <Button size="sm" variant={component.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => void submit(true)}>
                {component.confirmLabel ?? 'Confirm'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submit(false)}>
                {component.cancelLabel ?? 'Cancel'}
              </Button>
            </div>
          )}
          {component.kind === 'select' && !component.multi && (
            <div className="flex gap-2">
              <Select value={String(value)} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {component.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <Button size="sm" variant="primary" disabled={busy || !value} onClick={() => void submit(value)}>OK</Button>
            </div>
          )}
          {component.kind === 'select' && component.multi && (
            <div className="space-y-1.5">
              {component.options?.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={multiSel.includes(o.value)}
                    onChange={(e) =>
                      setMultiSel((s) => (e.target.checked ? [...s, o.value] : s.filter((x) => x !== o.value)))
                    }
                  />
                  {o.label}
                </label>
              ))}
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit(multiSel)}>OK</Button>
            </div>
          )}
          {(component.kind === 'text_input' || component.kind === 'number_input') && (
            <div className="flex gap-2">
              <Input
                type={component.kind === 'number_input' ? 'number' : 'text'}
                placeholder={component.placeholder}
                min={component.min}
                max={component.max}
                value={String(value)}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && value !== '') {
                    void submit(component.kind === 'number_input' ? Number(value) : value);
                  }
                }}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={busy || value === ''}
                onClick={() => void submit(component.kind === 'number_input' ? Number(value) : value)}
              >
                OK
              </Button>
            </div>
          )}
          {component.kind === 'slider' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  className="flex-1 accent-[var(--accent)]"
                  min={component.min}
                  max={component.max}
                  step={component.step ?? 1}
                  value={Number(value)}
                  onChange={(e) => setValue(Number(e.target.value))}
                />
                <span className="text-xs text-dim w-16 text-right">
                  {String(value)} {component.unit ?? ''}
                </span>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit(Number(value))}>OK</Button>
            </div>
          )}
          {component.kind === 'form' && (
            <div className="space-y-2">
              {component.fields?.map((f) => (
                <div key={f.name}>
                  <label className="block text-[11px] text-dim mb-0.5">{f.label}</label>
                  {f.type === 'select' ? (
                    <Select
                      value={String(formState[f.name] ?? '')}
                      onChange={(e) => setFormState((s) => ({ ...s, [f.name]: e.target.value }))}
                    >
                      <option value="">Choose…</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : f.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(formState[f.name])}
                      onChange={(e) => setFormState((s) => ({ ...s, [f.name]: e.target.checked }))}
                    />
                  ) : (
                    <Input
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={String(formState[f.name] ?? '')}
                      onChange={(e) =>
                        setFormState((s) => ({ ...s, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void submit(formState)}>Submit</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatResponse(response: unknown): string {
  if (typeof response === 'object') return JSON.stringify(response);
  return String(response);
}

/* ---------------- Plan card ---------------- */

function PlanCard({ plan, messageId, convId, onAction }: { plan: Plan; messageId: string; convId: string; onAction: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function resolve(approve: boolean) {
    setBusy(true);
    try {
      await api('POST', `/ai/conversations/${convId}/resolve-plan`, { messageId, planId: plan.id, approve });
      onAction();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="border border-edge-strong rounded-lg bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-semibold">{plan.title}</h4>
        <StatusBadge status={plan.status} />
      </div>
      <ol className="space-y-1">
        {plan.steps.map((s, i) => (
          <li key={s.id} className="text-xs flex gap-2">
            <span className="text-faint">{i + 1}.</span>
            <div>
              <span className="text-ink">{s.title}</span>
              {s.detail && <p className="text-faint">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
      {plan.status === 'proposed' && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void resolve(true)}>
            Approve plan
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resolve(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
