'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';
import { ToastProvider } from '@/components/ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
