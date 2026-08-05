'use client';

import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/api';
import { Card, EmptyState } from '@/components/ui';

interface AppRow { id: string; name: string; type: string; status: string }

export default function BackupsPage() {
  const { data } = useSWR<{ applications: AppRow[] }>('/apps', fetcher);
  const apps = data?.applications ?? [];
  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-lg font-semibold">Backups</h1>
      <Card className="p-4">
        <p className="text-xs text-dim mb-3">Backups are managed per application. Select one:</p>
        {apps.length === 0 ? (
          <EmptyState title="No applications" />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {apps.map((a) => (
              <Link key={a.id} href={`/apps/${a.id}?tab=backups`} className="border border-edge rounded-lg px-4 py-3 hover:bg-hover text-sm">
                {a.name} <span className="text-faint text-xs">({a.type})</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
