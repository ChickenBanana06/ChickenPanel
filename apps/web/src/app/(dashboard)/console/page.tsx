'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  Terminal, Play, Square, RotateCw, Trash2, Download, Copy,
  Search, ArrowDownCircle, Filter, Send, ChevronDown, Check,
  Blocks, Server, Sparkles
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Card, Button, StatusBadge, Spinner, cx, useToast } from '@/components/ui';

interface AppItem {
  id: string;
  name: string;
  type: string;
  status: string;
}

interface LogEntry {
  id: string;
  appId: string;
  appName: string;
  text: string;
  level: 'info' | 'warn' | 'error' | 'other';
  time: string;
}

export default function MultiConsolePage() {
  const toast = useToast();
  const [selectedAppId, setSelectedAppId] = useState<string>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [command, setCommand] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: appsData } = useSWR<{ applications: AppItem[] }>('/apps', fetcher);
  const apps = appsData?.applications ?? [];
  const runningApps = apps.filter((a) => a.status === 'running');

  // Pre-load initial logs when a specific server is chosen
  useEffect(() => {
    if (selectedAppId === 'all') return;
    let cancelled = false;
    api<{ lines: string[] }>('GET', `/apps/${selectedAppId}/logs?lines=150`)
      .then((res) => {
        if (cancelled) return;
        const appName = apps.find((a) => a.id === selectedAppId)?.name ?? 'Server';
        const parsed: LogEntry[] = (res.lines ?? []).map((line, idx) => ({
          id: `init-${selectedAppId}-${idx}-${Date.now()}`,
          appId: selectedAppId,
          appName,
          text: line,
          level: detectLevel(line),
          time: new Date().toLocaleTimeString(),
        }));
        setLogs(parsed);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedAppId, apps]);

  // Real-time console streaming via WebSocket
  const activeAppIds = useMemo(() => {
    if (selectedAppId !== 'all') return [selectedAppId];
    return runningApps.map((a) => a.id);
  }, [selectedAppId, runningApps]);

  // Subscribe to console topic for each active application
  activeAppIds.forEach((id) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRealtimeTopic(`app:${id}:console`, (evt) => {
      const line = typeof evt.data === 'string' ? evt.data : (evt.data as { line?: string })?.line ?? JSON.stringify(evt.data);
      const appName = apps.find((a) => a.id === id)?.name ?? 'Server';
      const entry: LogEntry = {
        id: `stream-${id}-${Date.now()}-${Math.random()}`,
        appId: id,
        appName,
        text: line,
        level: detectLevel(line),
        time: new Date().toLocaleTimeString(),
      };
      setLogs((prev) => [...prev.slice(-1000), entry]);
    });
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function detectLevel(text: string): 'info' | 'warn' | 'error' | 'other' {
    const l = text.toLowerCase();
    if (l.includes('error') || l.includes('exception') || l.includes('fatal') || l.includes('crashed')) return 'error';
    if (l.includes('warn') || l.includes('warning')) return 'warn';
    if (l.includes('info') || l.includes('started') || l.includes('loaded')) return 'info';
    return 'other';
  }

  const filteredLogs = logs.filter((log) => {
    if (selectedAppId !== 'all' && log.appId !== selectedAppId) return false;
    if (filterLevel === 'info' && log.level !== 'info') return false;
    if (filterLevel === 'warn' && log.level !== 'warn') return false;
    if (filterLevel === 'error' && log.level !== 'error') return false;
    if (search && !log.text.toLowerCase().includes(search.toLowerCase()) && !log.appName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function sendCommand(cmdToSend?: string) {
    const finalCmd = (cmdToSend ?? command).trim();
    if (!finalCmd) return;
    if (selectedAppId === 'all') {
      toast('error', 'Select a specific server from the dropdown to send commands.');
      return;
    }

    setSending(true);
    try {
      await api('POST', `/apps/${selectedAppId}/console`, { command: finalCmd });
      setCmdHistory((h) => [...h, finalCmd]);
      setHistoryIndex(-1);
      setCommand('');
      toast('success', `Sent: ${finalCmd}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Command execution failed');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void sendCommand();
    } else if (e.key === 'ArrowUp') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      const nextIdx = historyIndex === -1 ? cmdHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setCommand(cmdHistory[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      if (cmdHistory.length === 0 || historyIndex === -1) return;
      e.preventDefault();
      const nextIdx = historyIndex + 1;
      if (nextIdx >= cmdHistory.length) {
        setHistoryIndex(-1);
        setCommand('');
      } else {
        setHistoryIndex(nextIdx);
        setCommand(cmdHistory[nextIdx] ?? '');
      }
    }
  }

  function copyLogs() {
    const text = filteredLogs.map((l) => `[${l.appName}] ${l.text}`).join('\n');
    void navigator.clipboard.writeText(text);
    toast('success', 'Logs copied to clipboard');
  }

  function downloadLogs() {
    const text = filteredLogs.map((l) => `[${l.time}] [${l.appName}] ${l.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chickenpanel-console-${selectedAppId}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto h-[calc(100vh-6rem)] flex flex-col">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <Terminal size={20} className="text-accent" />
            <span>Multi-Server Console</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Consolidated live log stream and command execution across all instances.
          </p>
        </div>

        {/* Controls Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Server Selector */}
          <select
            value={selectedAppId}
            onChange={(e) => setSelectedAppId(e.target.value)}
            className="rounded-lg bg-raised border border-edge-strong px-3 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="all">🌐 All Running Servers ({runningApps.length})</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.type === 'minecraft' ? '⛏️' : '📦'} {a.name} ({a.status})
              </option>
            ))}
          </select>

          {/* Log Level Filters */}
          <div className="flex items-center rounded-lg border border-edge bg-raised/50 p-0.5 text-xs">
            {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setFilterLevel(lvl)}
                className={cx(
                  'px-2.5 py-1 rounded-md font-medium uppercase text-[11px] transition-colors',
                  filterLevel === lvl
                    ? lvl === 'error'
                      ? 'bg-bad/20 text-bad font-bold'
                      : lvl === 'warn'
                      ? 'bg-warn/20 text-warn font-bold'
                      : 'bg-accent/20 text-accent font-bold'
                    : 'text-faint hover:text-ink',
                )}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Quick Actions */}
          <Button
            size="sm"
            variant={autoScroll ? 'success' : 'default'}
            onClick={() => setAutoScroll((v) => !v)}
            title="Auto-scroll"
          >
            <ArrowDownCircle size={13} />
            <span className="hidden sm:inline">Scroll</span>
          </Button>

          <Button size="sm" variant="ghost" onClick={copyLogs} title="Copy logs">
            <Copy size={13} />
          </Button>

          <Button size="sm" variant="ghost" onClick={downloadLogs} title="Download .log">
            <Download size={13} />
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setLogs([])} title="Clear view">
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative shrink-0">
        <Search size={14} className="absolute left-3 top-2.5 text-faint" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter console output (e.g. 'player', 'warn', 'joined')..."
          className="w-full rounded-lg bg-panel border border-edge-strong pl-9 pr-4 py-1.5 text-xs text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Console Screen */}
      <Card className="flex-1 min-h-0 bg-[#080b11] border-edge-strong flex flex-col overflow-hidden shadow-2xl mc-card">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 console-font text-xs space-y-1 select-text">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-faint">
              <div>
                <Terminal size={32} className="mx-auto mb-2 opacity-30" />
                <p>No log output received yet.</p>
                <p className="text-[11px] opacity-70 mt-1">
                  Start an application or wait for events to stream.
                </p>
              </div>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const color =
                log.level === 'error'
                  ? 'text-red-400 bg-red-950/20'
                  : log.level === 'warn'
                  ? 'text-amber-300 bg-amber-950/20'
                  : 'text-slate-300';

              return (
                <div key={log.id} className={cx('leading-relaxed hover:bg-white/5 px-1 rounded flex items-start gap-2', color)}>
                  <span className="text-[10px] text-slate-600 select-none shrink-0 font-mono">
                    {log.time}
                  </span>
                  {selectedAppId === 'all' && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-sky-400 font-semibold shrink-0 select-none">
                      {log.appName}
                    </span>
                  )}
                  <span className="break-all whitespace-pre-wrap">{log.text}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Minecraft Command Chips */}
        {selectedAppId !== 'all' && (
          <div className="px-3 py-1.5 border-t border-edge/60 bg-panel/70 flex items-center gap-1.5 overflow-x-auto text-[11px]">
            <span className="text-faint shrink-0 font-medium">Quick:</span>
            {['/list', '/tps', '/version', '/save-all', '/help'].map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => void sendCommand(quick)}
                className="px-2 py-0.5 rounded bg-raised hover:bg-hover border border-edge text-dim hover:text-ink cursor-pointer font-mono whitespace-nowrap"
              >
                {quick}
              </button>
            ))}
          </div>
        )}

        {/* Console Command Input Bar */}
        <div className="p-2 border-t border-edge-strong bg-[#0d121c] flex items-center gap-2">
          <span className="text-accent font-mono pl-2 text-sm select-none">&gt;</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={selectedAppId === 'all' || sending}
            placeholder={
              selectedAppId === 'all'
                ? 'Select a specific server above to send console commands...'
                : 'Enter server command (e.g. op steve, say hello, kick alex)...'
            }
            className="flex-1 bg-transparent border-0 text-sm console-font text-ink placeholder:text-faint focus:outline-none disabled:opacity-50"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={selectedAppId === 'all' || !command.trim() || sending}
            onClick={() => void sendCommand()}
          >
            {sending ? <Spinner className="w-3 h-3" /> : <Send size={13} />}
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      </Card>
    </div>
  );
}
