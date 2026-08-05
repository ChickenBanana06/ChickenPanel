'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Field, Input, useToast } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const { data: setup } = useSWR<{ needsSetup: boolean }>('/auth/setup-status', fetcher);
  const [mode] = useState<'login' | 'register' | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveMode = mode ?? (setup?.needsSetup ? 'register' : 'login');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (effectiveMode === 'register') {
        await api('POST', '/auth/register', { username, email, password });
      } else {
        await api('POST', '/auth/login', { username, password });
      }
      refresh();
      router.push('/');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="flex items-center gap-2.5 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpeg" alt="ChickenPanel" className="w-10 h-10 rounded-xl object-cover" />
          <div>
            <h1 className="font-semibold leading-tight">ChickenPanel</h1>
            <p className="text-xs text-dim leading-tight">
              {effectiveMode === 'register' && setup?.needsSetup
                ? 'Create the administrator account'
                : 'Sign in to your panel'}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={3} />
          </Field>
          {effectiveMode === 'register' && (
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          )}
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={1}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : effectiveMode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        {!setup?.needsSetup && (
          <p className="mt-4 text-xs text-faint text-center">
            Accounts are created by an administrator in Settings → Users.
          </p>
        )}
      </Card>
    </div>
  );
}
