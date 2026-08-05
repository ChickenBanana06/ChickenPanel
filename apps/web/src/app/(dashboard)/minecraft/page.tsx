'use client';

import { AppList } from '@/components/app-list';

export default function MinecraftPage() {
  return <AppList title="Minecraft servers" typeFilter={['minecraft']} />;
}
