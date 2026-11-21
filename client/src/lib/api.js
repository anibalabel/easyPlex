import axios from 'axios';

const TOKEN_STORAGE_KEY = 'easyplex_token';

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage quota errors
  }
}

export const api = axios.create({
  baseURL: '/',
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/installer')) {
      // Clear stale token; UI router handles redirect
      const reqUrl = error.config?.url || '';
      if (!reqUrl.includes('/auth/login') && !reqUrl.includes('/installer-api')) {
        setStoredToken('');
      }
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(err, fallback = 'Request failed') {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback
  );
}

export function resolveMediaImage(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
    return url;
  }
  return `https://image.tmdb.org/t/p/w500${url.startsWith('/') ? '' : '/'}${url}`;
}

export default api;
