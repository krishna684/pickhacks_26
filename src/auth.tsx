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

  const [roleOverride, setRoleOverrideState] = useState<AppRole | null>(() => {
    const saved = localStorage.getItem('civicsafe_role_override');
    if (saved === 'citizen' || saved === 'operator' || saved === 'planner' || saved === 'admin') {
      return saved;
    }
    return null;
  });

  const [forceLoggedOut, setForceLoggedOut] = useState<boolean>(() => {
    return localStorage.getItem('civicsafe_force_logged_out') === 'true';
  });

  const setMockRole = (nextRole: AppRole) => {
    setRoleOverrideState(nextRole);
    localStorage.setItem('civicsafe_role_override', nextRole);
  };

  const roleClaimKey = import.meta.env.VITE_AUTH0_ROLE_CLAIM || 'https://civicsafe.app/role';
  const rawRole = user?.[roleClaimKey as keyof typeof user];
  const roleValue = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  const role = roleOverride ?? normalizeRole(roleValue);

  const performLogout = () => {
    localStorage.removeItem('civicsafe_role_override');
    setRoleOverrideState(null);

    localStorage.setItem('civicsafe_force_logged_out', 'true');
    setForceLoggedOut(true);

    (auth0Logout as unknown as (options?: unknown) => void)({ localOnly: true });
  };

  const performLogin = () => {
    localStorage.removeItem('civicsafe_force_logged_out');
    setForceLoggedOut(false);
    loginWithRedirect();
  };

  const effectiveIsAuthenticated = isAuthenticated && !forceLoggedOut;

  const value: AuthContextValue = useMemo(
    () => ({
      isLoading,
      isAuthenticated: effectiveIsAuthenticated,
      isMock: false,
      userName: user?.name || user?.email,
      role,
      login: performLogin,
      logout: performLogout,
      setMockRole,
      canAccessMode: (mode: ViewMode) => canAccessModeForRole(role, mode),
    }),
    [effectiveIsAuthenticated, isLoading, role, user?.email, user?.name]
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
