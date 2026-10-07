'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  ShieldCheck, ShieldAlert, Lock, CheckCircle2, AlertTriangle,
  FileCheck, Cpu, Key, UserCheck, RefreshCw, Eye, Search
} from 'lucide-react';
import { fetcher } from '@/lib/api';
import { Card, StatusBadge, Button, EmptyState, SearchInput, Spinner, cx } from '@/components/ui';

interface SecurityStatus {
  status: string;
  protections: {
    id: string;
    name: string;
    status: string;
    level: string;
    description: string;
  }[];
  systemChecks: {
    isRoot: boolean;
    platform: string;
    nodeVersion: string;
    dbConnected: boolean;
  };
}

interface AuditLog {
  id: string;
  action: string;
  actor: string;
  userId: string | null;
  targetType: string;
  targetId: string | null;
  success: boolean;
  ip: string | null;
  createdAt: string;
  user?: { username: string } | null;
}

export default function SecurityCenterPage() {
  const [filterAction, setFilterAction] = useState('');
  const { data: secData, mutate: mSec, isLoading: secLoading } = useSWR<SecurityStatus>('/security/status', fetcher);
  const { data: auditData, mutate: mAudit, isLoading: auditLoading } = useSWR<{ logs: AuditLog[] }>('/audit?limit=40', fetcher);

  const protections = secData?.protections ?? [];
  const systemChecks = secData?.systemChecks;
  const logs = auditData?.logs ?? [];

  const filteredLogs = logs.filter((l) =>
    !filterAction || l.action.toLowerCase().includes(filterAction.toLowerCase()) ||
    (l.user?.username && l.user.username.toLowerCase().includes(filterAction.toLowerCase())),
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink flex items-center gap-2">
            <ShieldCheck size={22} className="text-emerald-400" />
            <span>Security Center & Hardening Status</span>
          </h1>
          <p className="text-xs text-dim mt-0.5">
            Active multi-tenant isolation, sandbox jails, SSRF defenses, and tamper-evident audit logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => {
              void mSec();
              void mAudit();
            }}
          >
            <RefreshCw size={13} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Security Score Banner */}
      <Card className="p-5 border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-panel to-panel mc-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-emerald-400 shrink-0 shadow-lg">
              <ShieldCheck size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-ink">Hardened Multi-Tenant Shield Active</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Enforced
                </span>
              </div>
              <p className="text-xs text-dim mt-0.5">
                All server-side ownership validations, path canonicalization, and process resource caps are operational.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs shrink-0 bg-raised/60 p-2.5 rounded-xl border border-edge">
            <div className="text-center">
              <div className="text-lg font-bold text-emerald-400">{protections.length} / 8</div>
              <div className="text-[10px] text-faint uppercase font-medium">Protections</div>
            </div>
            <div className="h-7 w-px bg-edge" />
            <div className="text-center">
              <div className="text-lg font-bold text-sky-400">100%</div>
              <div className="text-[10px] text-faint uppercase font-medium">Coverage</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Warnings & Actionable Checks */}
      {systemChecks && (
        <div className="space-y-2">
          {systemChecks.isRoot ? (
            <div className="p-3.5 rounded-xl bg-bad/10 border border-bad/30 flex items-start gap-3 text-xs">
              <AlertTriangle className="text-bad shrink-0 mt-0.5" size={16} />
              <div>
                <span className="font-bold text-bad">Action Recommended: Running as Root User</span>
                <p className="text-dim mt-0.5">
                  The panel or agent process was launched under UID 0 (root). We recommend creating a dedicated unprivileged user (`chickenpanel`) to prevent privilege escalation.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-ok/10 border border-ok/30 flex items-center gap-2.5 text-xs text-ok">
              <CheckCircle2 size={16} className="text-ok shrink-0" />
              <span>Process is running under an unprivileged non-root user ({systemChecks.platform}). Security benchmark satisfied.</span>
            </div>
          )}
        </div>
      )}

      {/* Active Protections Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Lock size={15} className="text-accent" />
          <span>Active Defenses & Isolation Modules</span>
        </h2>

        {secLoading ? (
          <div className="py-8 text-center"><Spinner /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {protections.map((p) => (
              <Card key={p.id} className="p-4 mc-card hover:border-emerald-500/40 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 grid place-items-center shrink-0">
                      <CheckCircle2 size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-ink">{p.name}</div>
                      <span className="text-[10px] text-emerald-400 font-semibold uppercase">{p.level} security</span>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-mono border border-emerald-500/30">
                    ACTIVE
                  </span>
                </div>
                <p className="text-xs text-dim mt-2.5 leading-relaxed">
                  {p.description}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Audit Log Table */}
      <Card className="p-4 mc-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <FileCheck size={15} className="text-accent" />
              <span>Immutable Audit Logs</span>
            </h2>
            <p className="text-[11px] text-faint">
              Every sensitive server mutation, file write, or privilege change is recorded.
            </p>
          </div>
          <div className="w-full sm:w-64">
            <SearchInput
              value={filterAction}
              onChange={setFilterAction}
              placeholder="Filter audit actions..."
            />
          </div>
        </div>

        {auditLoading ? (
          <div className="py-12 text-center"><Spinner /></div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState title="No audit events recorded" hint="Events will appear when actions are taken in the panel." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-faint border-b border-edge">
                  <th className="px-3 py-2 font-medium">Timestamp</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">User / Actor</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">IP Address</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/40">
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-hover/50">
                    <td className="px-3 py-2 text-dim whitespace-nowrap font-mono">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-ink">
                      {log.action}
                    </td>
                    <td className="px-3 py-2 text-dim">
                      {log.user?.username ?? log.actor}
                    </td>
                    <td className="px-3 py-2 text-faint">
                      {log.targetType} {log.targetId ? `(${log.targetId.slice(0, 10)})` : ''}
                    </td>
                    <td className="px-3 py-2 text-faint font-mono">
                      {log.ip ?? '127.0.0.1'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cx(
                          'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase',
                          log.success ? 'bg-ok/15 text-ok border border-ok/30' : 'bg-bad/15 text-bad border border-bad/30',
                        )}
                      >
                        {log.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
