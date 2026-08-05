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
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
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
          <div className="w-9 h-9 rounded-xl bg-accent-strong grid place-items-center font-bold text-white">N</div>
          <div>
            <h1 className="font-semibold leading-tight">NexPanel</h1>
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
              minLength={effectiveMode === 'register' ? 10 : 1}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Please wait…' : effectiveMode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        {!setup?.needsSetup && (
          <button
            className="mt-4 text-xs text-dim hover:text-ink w-full text-center"
            onClick={() => setMode(effectiveMode === 'login' ? 'register' : 'login')}
          >
            {effectiveMode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
          </button>
        )}
      </Card>
    </div>
  );
}
