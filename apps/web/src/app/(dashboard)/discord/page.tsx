'use client';

import { AppList } from '@/components/app-list';

export default function DiscordPage() {
  return <AppList title="Discord bots" typeFilter={['discord-bot']} />;
}
