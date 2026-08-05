// Same-origin by default (the dashboard nginx proxies /api). For a separately
// hosted dashboard, set VITE_API_URL to the API origin — CORS_ORIGIN must allow
// it (see .env.example).
export const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');

/**
 * Fired when any API call returns 401 (expired/invalid session). The App shell
 * listens for it and swaps back to the login screen. No hard page redirect is
 * used — a redirect from /auth/me while already unauthenticated would loop.
 */
export const UNAUTHORIZED_EVENT = 'bothive:unauthorized';

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> ?? {}) };
  if (!headers['Content-Type'] && options.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error('Unauthorized');
  }

  let json: { error?: { message?: string }; data?: T };
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed: ${res.status}`);
  return json.data ?? (json as unknown as T);
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),

  login: async (email: string, password: string) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Login failed');
    return json.data.user;
  },

  register: async (email: string, password: string, name?: string) => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Registration failed');
    return json.data.user;
  },

  logout: async () => {
    try {
      await fetch(`${BASE}/auth/logout`, { method: 'POST' });
    } catch { /* best-effort */ }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const res = await fetch(`${BASE}/auth/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to change password');
    return json;
  },
};
