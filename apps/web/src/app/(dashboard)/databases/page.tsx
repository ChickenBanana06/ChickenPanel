'use client';

import { AppList } from '@/components/app-list';

export default function DatabasesPage() {
  return (
    <AppList
      title="Databases"
      typeFilter={['postgres', 'mysql', 'redis']}
      createTypes={['redis', 'postgres', 'mysql']}
    />
  );
}
