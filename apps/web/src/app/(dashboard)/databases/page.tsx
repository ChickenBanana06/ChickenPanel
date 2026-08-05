'use client';

import { Card } from '@/components/ui';
import { AppList } from '@/components/app-list';

export default function DatabasesPage() {
  return (
    <div className="space-y-4">
      <AppList title="Databases" typeFilter={['postgres', 'mysql', 'redis']} createTypes={['custom']} />
      <Card className="p-4 max-w-5xl">
        <p className="text-xs text-dim">
          Managed PostgreSQL / MySQL / Redis provisioning (automatic credentials, connection info) is part of
          Phase 5 and not implemented yet. The underlying application runtime, port allocation and backup
          architecture that will power it are already in place — for now you can run a database as a custom
          application with your own start command.
        </p>
      </Card>
    </div>
  );
}
