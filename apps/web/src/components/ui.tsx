'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, Search, AlertTriangle } from 'lucide-react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------------- Button ---------------- */

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success' | 'diamond' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const variants: Record<string, string> = {
    default: 'bg-raised border border-edge-strong hover:bg-hover text-ink shadow-sm',
    primary: 'bg-accent hover:bg-accent-strong text-white border border-transparent shadow-sm',
    diamond: 'bg-diamond/15 border border-diamond/40 text-diamond hover:bg-diamond/25 shadow-sm',
    danger: 'bg-bad/15 border border-bad/40 text-bad hover:bg-bad/25 shadow-sm',
    success: 'bg-ok/15 border border-ok/40 text-ok hover:bg-ok/25 shadow-sm',
    ghost: 'hover:bg-hover text-dim hover:text-ink border border-transparent',
    outline: 'border border-edge-strong hover:border-accent text-dim hover:text-ink hover:bg-hover',
  };

  const sizes: Record<string, string> = {
    xs: 'px-2 py-0.5 text-xs',
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base font-semibold',
  };

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-lg font-medium transition-all duration-150 inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        sizes[size],
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Inputs ---------------- */

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      {...rest}
      className={cx(
        'w-full rounded-lg bg-panel border border-edge-strong px-3 py-1.5 text-sm text-ink placeholder:text-faint',
        'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all',
        className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select
      {...rest}
      className={cx(
        'w-full rounded-lg bg-panel border border-edge-strong px-3 py-1.5 text-sm text-ink',
        'focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all cursor-pointer',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search servers, nodes, ports...',
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cx('relative flex items-center', className)}>
      <Search size={14} className="absolute left-3 text-faint pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-panel border border-edge-strong pl-9 pr-8 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2.5 text-faint hover:text-ink text-xs p-0.5 rounded"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="block text-xs font-medium text-dim mb-1">{children}</label>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/* ---------------- Card / Badge ---------------- */

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('bg-panel border border-edge rounded-xl transition-colors', className)} {...rest}>
      {children}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-ok/15 text-ok border-ok/40',
  ONLINE: 'bg-ok/15 text-ok border-ok/40',
  completed: 'bg-ok/15 text-ok border-ok/40',
  starting: 'bg-warn/15 text-warn border-warn/40',
  stopping: 'bg-warn/15 text-warn border-warn/40',
  provisioning: 'bg-warn/15 text-warn border-warn/40',
  creating: 'bg-warn/15 text-warn border-warn/40',
  deleting: 'bg-warn/15 text-warn border-warn/40',
  queued: 'bg-warn/15 text-warn border-warn/40',
  crashed: 'bg-bad/15 text-bad border-bad/40',
  errored: 'bg-bad/15 text-bad border-bad/40',
  failed: 'bg-bad/15 text-bad border-bad/40',
  OFFLINE: 'bg-raised text-faint border-edge-strong',
  stopped: 'bg-raised text-faint border-edge-strong',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-raised text-dim border-edge-strong';
  const live = ['running', 'ONLINE', 'starting', 'provisioning', 'stopping', 'deleting'].includes(status);
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider', color)}>
      {live && <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />}
      {status}
    </span>
  );
}

/* ---------------- Modal & Confirm Dialog ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cx(
          'relative bg-panel border border-edge-strong rounded-xl shadow-2xl w-full max-h-[88vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge sticky top-0 bg-panel/95 backdrop-blur z-10">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-dim hover:text-ink p-1 rounded-lg hover:bg-hover transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  danger = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-raised border border-edge-strong">
          <AlertTriangle className={danger ? 'text-bad shrink-0 mt-0.5' : 'text-warn shrink-0 mt-0.5'} size={20} />
          <p className="text-sm text-dim leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => void onConfirm()}
            disabled={busy}
          >
            {busy ? <Spinner className="w-3.5 h-3.5 mr-1" /> : null}
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Tabs ---------------- */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; icon?: React.ComponentType<{ size: number; className?: string }>; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-edge overflow-x-auto pb-px', className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cx(
              'flex items-center gap-2 px-3.5 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer',
              isActive
                ? 'border-accent text-accent bg-accent/5 rounded-t-lg'
                : 'border-transparent text-dim hover:text-ink hover:bg-hover/50 rounded-t-lg',
            )}
          >
            {Icon && <Icon size={14} className={isActive ? 'text-accent' : 'text-faint'} />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cx(
                  'px-1.5 py-0.2 rounded-full text-[10px]',
                  isActive ? 'bg-accent/20 text-accent font-semibold' : 'bg-raised text-faint',
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Resource Gauge ---------------- */

export function ResourceGauge({
  label,
  value,
  total,
  unit = '',
  percent,
}: {
  label: string;
  value?: number;
  total?: number;
  unit?: string;
  percent: number;
}) {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const barColor = p > 85 ? 'bg-bad' : p > 70 ? 'bg-warn' : 'bg-ok';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-dim font-medium">{label}</span>
        <span className="text-ink font-semibold">
          {value !== undefined && total !== undefined ? `${value}/${total} ${unit} ` : ''}
          <span className="text-faint font-normal">({p}%)</span>
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
        <div className={cx('h-full transition-all duration-500', barColor)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur bg-panel/95 animate-in slide-in-from-bottom-3 duration-200',
              t.kind === 'success' && 'border-ok/40 text-ok',
              t.kind === 'error' && 'border-bad/40 text-bad',
              t.kind === 'info' && 'border-edge-strong text-ink',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ---------------- Misc ---------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block w-4 h-4 rounded-full border-2 border-dim border-t-transparent animate-spin', className)}
    />
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-4 space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-raised border border-edge mx-auto grid place-items-center text-dim text-lg">
        🐤
      </div>
      <div>
        <p className="text-ink font-medium text-sm">{title}</p>
        {hint && <p className="text-faint text-xs mt-1 max-w-sm mx-auto">{hint}</p>}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
      <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
