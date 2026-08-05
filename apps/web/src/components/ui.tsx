'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

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
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const variants: Record<string, string> = {
    default: 'bg-raised border border-edge-strong hover:bg-hover text-ink',
    primary: 'bg-accent-strong hover:bg-accent text-white border border-transparent',
    danger: 'bg-bad/15 border border-bad/40 text-bad hover:bg-bad/25',
    success: 'bg-ok/15 border border-ok/40 text-ok hover:bg-ok/25',
    ghost: 'hover:bg-hover text-dim hover:text-ink border border-transparent',
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
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
        'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
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
        'focus:outline-none focus:ring-2 focus:ring-accent/50',
        className,
      )}
    >
      {children}
    </select>
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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-panel border border-edge rounded-xl', className)}>{children}</div>;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-ok/15 text-ok border-ok/30',
  ONLINE: 'bg-ok/15 text-ok border-ok/30',
  completed: 'bg-ok/15 text-ok border-ok/30',
  starting: 'bg-warn/15 text-warn border-warn/30',
  stopping: 'bg-warn/15 text-warn border-warn/30',
  provisioning: 'bg-warn/15 text-warn border-warn/30',
  creating: 'bg-warn/15 text-warn border-warn/30',
  deleting: 'bg-warn/15 text-warn border-warn/30',
  queued: 'bg-warn/15 text-warn border-warn/30',
  crashed: 'bg-bad/15 text-bad border-bad/30',
  errored: 'bg-bad/15 text-bad border-bad/30',
  failed: 'bg-bad/15 text-bad border-bad/30',
  OFFLINE: 'bg-bad/15 text-bad border-bad/30',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-raised text-dim border-edge-strong';
  const live = ['running', 'ONLINE', 'starting', 'provisioning', 'stopping', 'deleting'].includes(status);
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', color)}>
      {live && <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />}
      {status}
    </span>
  );
}

/* ---------------- Modal ---------------- */

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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={cx(
          'relative bg-panel border border-edge-strong rounded-xl shadow-2xl w-full max-h-[85vh] overflow-y-auto',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-edge sticky top-0 bg-panel z-10">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-dim hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
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
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'rounded-lg border px-4 py-2.5 text-sm shadow-xl backdrop-blur bg-panel/95',
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

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-dim text-sm">{title}</p>
      {hint && <p className="text-faint text-xs mt-1">{hint}</p>}
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
