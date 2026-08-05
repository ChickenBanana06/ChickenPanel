'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Boxes, Globe, Bot, Database, HardDrive, ListChecks,
  Server, Settings, LogOut, PanelRightClose, PanelRightOpen, Blocks,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { cx, Spinner } from './ui';
import { AIPanel } from './ai/panel';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/apps', label: 'Applications', icon: Boxes },
  { href: '/minecraft', label: 'Minecraft', icon: Blocks },
  { href: '/websites', label: 'Websites', icon: Globe },
  { href: '/discord', label: 'Discord bots', icon: Bot },
  { href: '/databases', label: 'Databases', icon: Database },
  { href: '/nodes', label: 'Nodes', icon: Server },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/backups', label: 'Backups', icon: HardDrive },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [aiOpen, setAiOpen] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    const saved = window.localStorage.getItem('nexpanel.aiOpen');
    if (saved !== null) setAiOpen(saved === '1');
  }, []);
  const toggleAi = (open: boolean) => {
    setAiOpen(open);
    window.localStorage.setItem('nexpanel.aiOpen', open ? '1' : '0');
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Topbar */}
      <header className="h-12 border-b border-edge flex items-center px-4 gap-4 shrink-0 bg-panel/60">
        <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
          <span className="w-6 h-6 rounded-lg bg-accent-strong grid place-items-center text-white text-xs font-bold">N</span>
          NexPanel
        </Link>
        <div className="flex-1" />
        <span className="text-xs text-dim">
          {user.username} <span className="text-faint">({user.role.toLowerCase()})</span>
        </span>
        <button
          title="Sign out"
          className="text-dim hover:text-ink"
          onClick={async () => {
            await api('POST', '/auth/logout').catch(() => undefined);
            window.location.href = '/login';
          }}
        >
          <LogOut size={15} />
        </button>
        <button
          title={aiOpen ? 'Hide AI panel' : 'Show AI panel'}
          className="text-dim hover:text-ink"
          onClick={() => toggleAi(!aiOpen)}
        >
          {aiOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <nav className="w-48 border-r border-edge shrink-0 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                  active ? 'bg-accent/15 text-accent font-medium' : 'text-dim hover:text-ink hover:bg-hover',
                )}
              >
                <item.icon size={15} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto p-6">{children}</main>

        {/* AI panel */}
        {aiOpen && <AIPanel onClose={() => toggleAi(false)} />}
      </div>
    </div>
  );
}
