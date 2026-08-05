'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { RotateCw, Square } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import { useRealtimeTopic } from '@/lib/realtime';
import { Button, Card, EmptyState, Modal, ProgressBar, StatusBadge, useToast } from '@/components/ui';

interface TaskRow {
  id: string; kind: string; title: string; status: string; progress: number;
  error: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
interface TaskLogRow { id: string; ts: string; level: string; message: string }

export default function TasksPage() {
  const toast = useToast();
  const { data, mutate } = useSWR<{ tasks: TaskRow[] }>('/tasks?limit=100', fetcher);
  const [selected, setSelected] = useState<string | null>(null);
  useRealtimeTopic('tasks', () => void mutate());
  const tasks = data?.tasks ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-lg font-semibold">Tasks</h1>
      <Card>
        {tasks.length === 0 ? (
          <EmptyState title="No tasks yet" hint="Provisioning, backups and AI jobs appear here." />
        ) : (
          <div className="divide-y divide-edge/50">
            {tasks.map((t) => (
              <div key={t.id} className="px-4 py-3 hover:bg-hover/40 cursor-pointer" onClick={() => setSelected(t.id)}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t.title}</div>
                    <div className="text-xs text-faint">
                      {t.kind} · {new Date(t.createdAt).toLocaleString()}
                      {t.error && <span className="text-bad"> · {t.error.slice(0, 120)}</span>}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                  {t.status === 'running' && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async (e?: unknown) => {
                        (e as React.MouseEvent | undefined)?.stopPropagation?.();
                        await api('POST', `/tasks/${t.id}/cancel`).catch(() => undefined);
                      }}
                    >
                      <Square size={12} />
                    </Button>
                  )}
                  {(t.status === 'failed' || t.status === 'cancelled') && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await api('POST', `/tasks/${t.id}/retry`);
                          toast('info', 'Task requeued');
                          void mutate();
                        } catch (err) {
                          toast('error', err instanceof Error ? err.message : 'Retry failed');
                        }
                      }}
                    >
                      <RotateCw size={12} />
                    </Button>
                  )}
                </div>
                {t.status === 'running' && (
                  <div className="mt-2"><ProgressBar value={t.progress} /></div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <TaskDetailModal taskId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function TaskDetailModal({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { data, mutate } = useSWR<{ task: TaskRow; logs: TaskLogRow[] }>(taskId ? `/tasks/${taskId}` : null, fetcher);
  useRealtimeTopic(taskId ? `task:${taskId}` : null, () => void mutate());
  return (
    <Modal open={taskId !== null} onClose={onClose} title={data?.task.title ?? 'Task'} wide>
      {data && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <StatusBadge status={data.task.status} />
            <span className="text-xs text-dim">{data.task.kind}</span>
            {data.task.status === 'running' && <div className="flex-1"><ProgressBar value={data.task.progress} /></div>}
          </div>
          {data.task.error && <p className="text-xs text-bad">{data.task.error}</p>}
          <div className="console-font text-xs bg-bg border border-edge rounded-lg p-3 max-h-96 overflow-y-auto">
            {data.logs.length === 0 && <p className="text-faint">No logs.</p>}
            {data.logs.map((l) => (
              <div key={l.id} className={l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-ink/85'}>
                <span className="text-faint">{new Date(l.ts).toLocaleTimeString()} </span>
                {l.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
