'use client';

import { AppList } from '@/components/app-list';

export default function WebsitesPage() {
  return <AppList title="Websites" typeFilter={['website', 'node']} />;
}
