import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { getStoredToken, setStoredToken } from '../lib/api';

const AuthContext = createContext({
  user: null,
  loading: true,
  isAuthenticated: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
  hasPermission: () => false,
  hasAnyPermission: () => false,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { data } = await api.get('/admin/auth/profile');
      const profile = data?.user || data;
      setUser(profile);
      setLoading(false);
      return profile;
    } catch {
      try {
        const { data } = await api.get('/api/user');
        setUser(data);
        setLoading(false);
        return data;
      } catch {
        setStoredToken('');
        setUser(null);
        setLoading(false);
        return null;
      }
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Keep session fresh every 15 minutes
  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      api.get('/admin/session/keep-alive').catch(() => {});
    }, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user]);

  const login = useCallback(async ({ email, password }) => {
    const { data } = await api.post('/auth/login', { email, password });
    const token = data?.token || data?.access_token;
    if (token) setStoredToken(token);
    setUser(data?.user || null);
    return data;
  }, []);

  const register = useCallback(async ({ name, email, password, password_confirmation }) => {
    const { data } = await api.post('/auth/register', {
      name,
      email,
      password,
      password_confirmation,
    });
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    setStoredToken('');
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permKey) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      const list = Array.isArray(user.permissions) ? user.permissions : [];
      return list.includes(permKey);
    },
    [user]
  );

  const hasAnyPermission = useCallback(
    (keys = []) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      return keys.some((k) => hasPermission(k));
    },
    [user, hasPermission]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: Boolean(user),
        login,
        register,
        logout,
        refreshUser,
        hasPermission,
        hasAnyPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
