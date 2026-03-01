import React, { createContext, useContext, useMemo, useState } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import type { ViewMode } from './types';

type AppRole = 'citizen' | 'operator' | 'planner' | 'admin';

type AuthContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isMock: boolean;
  userName?: string;
  role: AppRole;
  login: () => void;
  logout: () => void;
  setMockRole?: (role: AppRole) => void;
  canAccessMode: (mode: ViewMode) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeRole(rawRole: unknown): AppRole {
  if (rawRole === 'operator' || rawRole === 'planner' || rawRole === 'admin') {
    return rawRole;
  }
  return 'citizen';
}

function canAccessModeForRole(role: AppRole, mode: ViewMode) {
  if (mode === 'citizen') return true;
  if (mode === 'operator') return role === 'operator' || role === 'admin';
  return role === 'planner' || role === 'admin';
}

function Auth0BackedProvider({ children }: { children: React.ReactNode }) {
  const {
    isLoading,
    isAuthenticated,
    user,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();

  const roleClaimKey = import.meta.env.VITE_AUTH0_ROLE_CLAIM || 'https://civicsafe.app/role';
  const rawRole = user?.[roleClaimKey as keyof typeof user];
  const roleValue = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  const role = normalizeRole(roleValue);

  const value: AuthContextValue = useMemo(
    () => ({
      isLoading,
      isAuthenticated,
      isMock: false,
      userName: user?.name || user?.email,
      role,
      login: () => loginWithRedirect(),
      logout: () =>
        auth0Logout({
          logoutParams: { returnTo: window.location.origin },
        }),
      canAccessMode: (mode: ViewMode) => canAccessModeForRole(role, mode),
    }),
    [auth0Logout, isAuthenticated, isLoading, loginWithRedirect, role, user?.email, user?.name]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function MockProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('civicsafe_mock_authenticated') === 'true';
  });

  const [role, setRole] = useState<AppRole>(() => {
    const saved = localStorage.getItem('civicsafe_mock_role');
    return normalizeRole(saved);
  });

  const setMockRole = (nextRole: AppRole) => {
    setRole(nextRole);
    localStorage.setItem('civicsafe_mock_role', nextRole);
  };

  const login = () => {
    setIsAuthenticated(true);
    localStorage.setItem('civicsafe_mock_authenticated', 'true');
  };

  const logout = () => {
    setIsAuthenticated(false);
    localStorage.setItem('civicsafe_mock_authenticated', 'false');
  };

  const value: AuthContextValue = useMemo(
    () => ({
      isLoading: false,
      isAuthenticated,
      isMock: true,
      userName: 'Local Demo User',
      role,
      login,
      logout,
      setMockRole,
      canAccessMode: (mode: ViewMode) => canAccessModeForRole(role, mode),
    }),
    [isAuthenticated, role]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  const domain = import.meta.env.VITE_AUTH0_DOMAIN;
  const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
  const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

  if (domain && clientId) {
    return (
      <Auth0Provider
        domain={domain}
        clientId={clientId}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: audience || undefined,
        }}
      >
        <Auth0BackedProvider>{children}</Auth0BackedProvider>
      </Auth0Provider>
    );
  }

  return <MockProvider>{children}</MockProvider>;
}

export function useAppAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAppAuth must be used inside AppAuthProvider');
  }
  return context;
}
