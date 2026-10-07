'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  LayoutDashboard, Boxes, Globe, Bot, Database, HardDrive, ListChecks,
  Server, Settings, LogOut, PanelRightClose, PanelRightOpen, Blocks,
  Terminal, Network, ShieldCheck, Menu, X, Search, Sparkles
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, fetcher } from '@/lib/api';
import { cx, Spinner, Modal } from './ui';
import { AIPanel } from './ai/panel';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/apps', label: 'Applications', icon: Boxes },
  { href: '/minecraft', label: 'Minecraft', icon: Blocks },
  { href: '/console', label: 'Multi-Console', icon: Terminal },
  { href: '/topology', label: 'Network Topology', icon: Network },
  { href: '/security', label: 'Security Center', icon: ShieldCheck },
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: nodesData } = useSWR<{ nodes: { connected: boolean }[] }>('/nodes', fetcher, { refreshInterval: 15000 });
  const { data: appsData } = useSWR<{ applications: { id: string; name: string; type: string; status: string }[] }>('/apps', fetcher);

  const onlineNodes = (nodesData?.nodes ?? []).filter((n) => n.connected).length;
  const totalNodes = nodesData?.nodes?.length ?? 0;

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

  // Keyboard shortcut Ctrl+K / Cmd+K for quick navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-bg">
        <Spinner />
      </div>
    );
  }

  const filteredApps = (appsData?.applications ?? []).filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.type.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Topbar */}
      <header className="h-12 border-b border-edge flex items-center px-4 gap-3 shrink-0 bg-panel/80 backdrop-blur z-20">
        <button
          type="button"
          className="md:hidden text-dim hover:text-ink p-1"
          onClick={() => setMobileNavOpen((v) => !v)}
          title="Toggle Navigation"
        >
          {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <Link href="/" className="flex items-center gap-2.5 font-bold text-sm tracking-wide text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpeg" alt="ChickenPanel" className="w-7 h-7 rounded-lg object-cover ring-1 ring-edge shadow" />
          <span className="hidden sm:inline bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400 bg-clip-text text-transparent">
            ChickenPanel
          </span>
        </Link>

        {/* Quick Search Shortcut Bar */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="hidden sm:flex items-center gap-2 bg-raised/80 hover:bg-hover border border-edge-strong px-2.5 py-1 rounded-lg text-xs text-dim hover:text-ink transition-colors ml-4 cursor-pointer"
        >
          <Search size={13} className="text-faint" />
          <span>Quick search...</span>
          <kbd className="bg-panel px-1.5 py-0.5 rounded text-[10px] text-faint font-mono border border-edge">⌘K</kbd>
        </button>

        <div className="flex-1" />

        {/* Node Connectivity Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-edge bg-raised/50 text-[11px]">
          <span className={cx('w-2 h-2 rounded-full', onlineNodes > 0 ? 'bg-ok pulse-dot' : 'bg-faint')} />
          <span className="text-dim">
            Nodes: <span className="text-ink font-medium">{onlineNodes}/{totalNodes}</span>
          </span>
        </div>

        {/* User Pill */}
        <div className="flex items-center gap-2 text-xs text-dim">
          <span className="text-ink font-medium">{user.username}</span>
          <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold text-[10px] uppercase tracking-wider border border-accent/20">
            {user.role}
          </span>
        </div>

        <button
          title="Sign out"
          className="text-dim hover:text-bad p-1.5 rounded-lg hover:bg-hover transition-colors"
          onClick={async () => {
            await api('POST', '/auth/logout').catch(() => undefined);
            window.location.href = '/login';
          }}
        >
          <LogOut size={15} />
        </button>

        <button
          title={aiOpen ? 'Hide AI Operator' : 'Open AI Operator'}
          className={cx(
            'p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium',
            aiOpen ? 'bg-accent/15 text-accent border border-accent/30' : 'text-dim hover:text-ink hover:bg-hover',
          )}
          onClick={() => toggleAi(!aiOpen)}
        >
          <Sparkles size={15} />
          <span className="hidden md:inline">AI Operator</span>
          {aiOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        {/* Mobile backdrop */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-30 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Sidebar */}
        <nav
          className={cx(
            'w-52 border-r border-edge shrink-0 py-3 px-2 space-y-0.5 overflow-y-auto bg-panel/50 backdrop-blur z-40 transition-transform duration-200 md:translate-x-0',
            mobileNavOpen ? 'fixed top-12 bottom-0 left-0 translate-x-0 bg-panel shadow-2xl' : 'hidden md:block',
          )}
        >
          <div className="px-3 py-1 text-[11px] font-semibold text-faint uppercase tracking-wider mb-1">
            Server Ops
          </div>
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all font-medium',
                  active
                    ? 'bg-accent/15 text-accent border border-accent/25 shadow-sm'
                    : 'text-dim hover:text-ink hover:bg-hover border border-transparent',
                )}
              >
                <item.icon size={16} className={active ? 'text-accent' : 'text-dim'} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4 md:p-6">{children}</main>

        {/* AI Operator Sidebar */}
        {aiOpen && <AIPanel onClose={() => toggleAi(false)} />}
      </div>

      {/* Global Quick Search Modal */}
      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Quick Jump (Search Servers & Pages)">
        <div className="space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-2.5 text-faint" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, Minecraft, bot, database..."
              className="w-full rounded-lg bg-raised border border-edge-strong pl-9 pr-4 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 divide-y divide-edge/30">
            <div className="text-[11px] font-semibold text-faint uppercase tracking-wider py-1">Quick Links</div>
            <div className="grid grid-cols-2 gap-1 py-1">
              {NAV.map((n) => (
                <button
                  key={n.href}
                  type="button"
                  onClick={() => {
                    router.push(n.href);
                    setSearchOpen(false);
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-hover text-xs text-dim hover:text-ink text-left"
                >
                  <n.icon size={13} />
                  <span>{n.label}</span>
                </button>
              ))}
            </div>

            {filteredApps.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-faint uppercase tracking-wider pt-2 pb-1">
                  Applications ({filteredApps.length})
                </div>
                {filteredApps.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      router.push(`/apps/${a.id}`);
                      setSearchOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-hover text-xs text-left cursor-pointer"
                  >
                    <div>
                      <div className="font-medium text-ink">{a.name}</div>
                      <div className="text-faint text-[10px]">{a.type}</div>
                    </div>
                    <span className="text-[10px] font-semibold uppercase text-accent">{a.status}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
