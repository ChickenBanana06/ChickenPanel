'use client';

import { createContext, useContext, type ReactNode } from 'react';
import useSWR from 'swr';
import { fetcher } from './api';

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  role: string;
  permissions: string[];
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => void;
  can: (perm: string) => boolean;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refresh: () => undefined, can: () => false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, mutate } = useSWR<{ user: CurrentUser }>('/auth/me', fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const user = data?.user ?? null;
  return (
    <AuthContext.Provider
      value={{
        user,
        loading: isLoading,
        refresh: () => void mutate(),
        can: (perm) => user?.permissions.includes(perm) ?? false,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
