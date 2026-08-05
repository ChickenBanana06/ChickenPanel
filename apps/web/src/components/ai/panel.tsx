'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Plus, Menu, Send, Square, ChevronDown, ChevronRight, Wrench,
  Check, XIcon, AlertTriangle, Trash2, MessageSquare,
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Input, Select, Spinner, cx, useToast, StatusBadge } from '../ui';

/* ---------------- Types mirrored from the API ---------------- */

interface Conversation {
  id: string;
  name: string;
  model: string;
  state: string;
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

/* ---------------- Panel ---------------- */

export function AIPanel({ onClose: _onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
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
    if (!activeId && conversations.length > 0) setActiveId(conversations[0]!.id);
  }, [activeId, conversations]);

  return (
    <aside className="w-[380px] shrink-0 border-l border-edge flex flex-col bg-panel/40">
      {/* Header */}
      <div className="h-11 border-b border-edge flex items-center px-3 gap-2 shrink-0">
        <button className="text-dim hover:text-ink" title="Conversations" onClick={() => setShowList((v) => !v)}>
          <Menu size={16} />
        </button>
        <div className="flex-1 min-w-0">
          {active ? (
            <div className="truncate text-sm font-medium">{active.name}</div>
          ) : (
            <div className="text-sm text-dim">AI Assistant</div>
          )}
        </div>
        {active && (
          <span className="text-[10px] text-faint whitespace-nowrap">
            {active.provider?.displayName} · {STATE_LABELS[active.state] ?? active.state}
          </span>
        )}
        <button
          className="text-dim hover:text-ink"
          title="New conversation"
          onClick={() => {
            setShowNew(true);
            setShowList(false);
          }}
        >
          <Plus size={16} />
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
  return (
    <div className="border-b border-edge max-h-64 overflow-y-auto">
      {conversations.length === 0 && <p className="text-xs text-faint p-3">No conversations.</p>}
      {conversations.map((c) => (
        <div
          key={c.id}
          className={cx(
            'flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-edge/50 last:border-b-0',
            c.id === activeId ? 'bg-accent/10' : 'hover:bg-hover',
          )}
          onClick={() => onSelect(c.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[13px] truncate">{c.name}</div>
            <div className="text-[10px] text-faint">
              {c.provider?.displayName} · {c.model.split('/').pop()}
            </div>
          </div>
          <span
            className={cx(
              'text-[10px]',
              c.state === 'running' && 'text-ok',
              c.state === 'waiting_input' && 'text-warn',
              c.state === 'waiting_approval' && 'text-warn',
              c.state === 'errored' && 'text-bad',
            )}
          >
            {c.state === 'running' ? '🟢' : c.state === 'waiting_input' || c.state === 'waiting_approval' ? '⏸' : ''}
          </span>
          <button
            className="text-faint hover:text-bad"
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
            <Trash2 size={12} />
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
  const [busy, setBusy] = useState(false);
  const effectiveProvider = providerId || providers[0]?.id || '';

  const { data: modelData, isLoading: modelsLoading } = useSWR<{ models: { id: string; displayName: string }[] }>(
    effectiveProvider ? `/ai/providers/${effectiveProvider}/models` : null,
    fetcher,
    { shouldRetryOnError: false },
  );
  const models = modelData?.models ?? [];
  const effectiveModel = model || models[0]?.id || '';

  return (
    <div className="p-4 space-y-3 border-b border-edge">
      <h3 className="text-sm font-semibold">New conversation</h3>
      {providers.length === 0 ? (
        <p className="text-xs text-warn">
          No AI providers configured. Add one in Settings → AI Providers.
        </p>
      ) : (
        <>
          <Input placeholder="Name (e.g. Minecraft Mod)" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={effectiveProvider} onChange={(e) => { setProviderId(e.target.value); setModel(''); }}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </Select>
          <Select value={effectiveModel} onChange={(e) => setModel(e.target.value)} disabled={modelsLoading}>
            {modelsLoading && <option>Loading models…</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </Select>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !effectiveProvider || !effectiveModel}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await api<{ conversation: { id: string } }>('POST', '/ai/conversations', {
                name: name || 'New chat',
                providerId: effectiveProvider,
                model: effectiveModel,
              });
              onCreated(res.conversation.id);
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed to create');
            } finally {
              setBusy(false);
            }
          }}
        >
          Create
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
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const refetch = useCallback(() => {
    void mutate();
    onStateChange();
  }, [mutate, onStateChange]);

  useRealtimeTopic(`chat:${convId}`, (evt) => {
    if (evt.event === 'stream.text') {
      setStreamText((t) => t + (evt.data as { delta: string }).delta);
    } else if (
      ['message.assistant', 'ui.ask', 'plan.proposed', 'tool.awaiting_approval', 'tool.finished', 'run.done', 'run.error', 'state'].includes(
        evt.event,
      )
    ) {
      if (evt.event === 'message.assistant') setStreamText('');
      refetch();
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamText]);

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput('');
    setBusy(true);
    try {
      await api('POST', `/ai/conversations/${convId}/messages`, { content });
      refetch();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Send failed');
      setInput(content);
    } finally {
      setBusy(false);
    }
  }

  const running = state === 'running';

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streamText && (
          <p className="text-xs text-faint text-center mt-8">
            Ask the AI to create servers, write plugins, deploy bots, manage files…
          </p>
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

      <div className="border-t border-edge p-3 shrink-0">
        <div className="flex gap-2">
          <Input
            placeholder={running ? 'Agent is running…' : 'Message the AI…'}
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
            <Button variant="primary" onClick={() => void send()} disabled={busy || !input.trim()}>
              <Send size={14} />
            </Button>
          )}
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
        <div className="px-2.5 pb-2 flex items-center gap-2">
          <span className="text-warn flex-1">Approval required</span>
          <Button size="sm" variant="success" onClick={() => approve(true)}>Allow</Button>
          <Button size="sm" variant="danger" onClick={() => approve(false)}>Deny</Button>
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
        <p className="text-xs text-ok flex items-center gap-1.5">
          <Check size={12} /> {formatResponse(response)}
        </p>
      ) : (
        <>
          {component.kind === 'buttons' && (
            <div className="flex flex-wrap gap-1.5">
              {component.options?.map((o) => (
                <Button key={o.value} size="sm" disabled={busy} onClick={() => void submit(o.value)}>
                  {o.label}
                </Button>
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
