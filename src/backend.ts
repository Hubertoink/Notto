import { invoke, isTauri } from '@tauri-apps/api/core';
import type { SupabaseClient } from '@supabase/supabase-js';
export interface ServerUser {
  id: string;
  email: string;
}
const desktop = isTauri();
const buses = new Map<string, BroadcastChannel>();
export function createNottoClient(url: string): SupabaseClient {
  const base = url.replace(/\/$/, '');
  const userCache = `notto-user:${base}`;
  const remember = (user: ServerUser | null) => {
    if (user) localStorage.setItem(userCache, JSON.stringify(user));
    else localStorage.removeItem(userCache);
  };
  let sessionToken: string | null = null,
    loaded = false;
  const listeners = new Set<(event: string, session: { user: ServerUser } | null) => void>();
  const bus =
    typeof BroadcastChannel === 'undefined'
      ? null
      : buses.get(base) || new BroadcastChannel(`notto-auth:${base}`);
  if (bus) buses.set(base, bus);
  async function request(path: string, options: RequestInit = {}, blob = false): Promise<any> {
    if (desktop && !loaded) {
      sessionToken = await invoke<string | null>('server_session_get', { server: base });
      loaded = true;
    }
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (desktop) headers.set('X-Notto-Client', 'desktop');
    if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
    const response = await fetch(`${base}/api${path}`, {
      ...options,
      headers,
      credentials: 'include',
      signal: AbortSignal.timeout(path.startsWith('/auth/') ? 15000 : 130000),
    });
    if (!response.ok) {
      let message = `Server nicht erreichbar (${response.status}).`;
      try {
        message = (await response.json()).error || message;
      } catch {}
      throw Object.assign(new Error(message), { statusCode: String(response.status) });
    }
    return blob ? response.blob() : response.json();
  }
  const safe = async (fn: () => Promise<any>) => {
    try {
      return { data: await fn(), error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  };
  async function session() {
    const data = await request('/auth/session');
    remember(data.user || null);
    return data.user ? { user: data.user } : null;
  }
  const notify = async () => {
    const value = await session().catch(() => null);
    listeners.forEach((fn) => fn(value ? 'SIGNED_IN' : 'SIGNED_OUT', value));
  };
  bus?.addEventListener('message', () => {
    loaded = false;
    void notify();
  });
  async function authenticate(path: string, p: unknown) {
    const result = await safe(async () => {
      const data = await request(path, { method: 'POST', body: JSON.stringify(p) });
      remember(data.user);
      if (desktop) {
        await invoke('server_session_set', { server: base, secret: data.token });
        sessionToken = data.token;
        loaded = true;
      }
      listeners.forEach((fn) => fn('SIGNED_IN', { user: data.user }));
      bus?.postMessage('changed');
      return { user: data.user, session: { user: data.user } };
    });
    return result;
  }
  const adapter = {
    auth: {
      getSession: async () => {
        try {
          return { data: { session: await session() }, error: null };
        } catch (error) {
          let cached: ServerUser | null = null;
          try {
            const value = JSON.parse(localStorage.getItem(userCache) || 'null');
            if (typeof value?.id === 'string' && typeof value?.email === 'string') cached = value;
          } catch {}
          return { data: { session: cached ? { user: cached } : null }, error };
        }
      },
      getUser: async () => {
        try {
          return { data: { user: (await session())?.user || null }, error: null };
        } catch (error) {
          return { data: { user: null }, error };
        }
      },
      onAuthStateChange: (fn: (event: string, session: { user: ServerUser } | null) => void) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
      signInWithPassword: (p: unknown) => authenticate('/auth/login', p),
      signUp: (p: any) =>
        authenticate('/auth/register', {
          email: p.email,
          password: p.password,
          invite: p.options?.data?.invite,
        }),
      signOut: async () => {
        const result = await safe(() => request('/auth/logout', { method: 'POST', body: '{}' }));
        if (!result.error) {
          if (desktop) await invoke('server_session_set', { server: base, secret: '' });
          sessionToken = null;
          remember(null);
          listeners.forEach((fn) => fn('SIGNED_OUT', null));
          bus?.postMessage('changed');
        }
        return result;
      },
    },
    rpc: (name: string, p: unknown) =>
      safe(() => {
        if (name !== 'push_note') throw new Error('Unbekannte Serverfunktion');
        return request('/notes/push', { method: 'POST', body: JSON.stringify(p) });
      }),
    from: (table: string) => {
      if (!['notes', 'knowledge'].includes(table)) throw new Error('Unbekannte Sammlung');
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: async (start: number) => {
          try {
            return { data: (await request(`/${table}?offset=${start}`)).data, error: null };
          } catch (error) {
            return { data: null, error };
          }
        },
        upsert: (rows: any[]) =>
          safe(() =>
            request('/knowledge', { method: 'POST', body: JSON.stringify(rows.map((r) => r.document)) }),
          ),
      };
      return chain;
    },
    storage: {
      from: () => ({
        upload: (path: string, bytes: Uint8Array, options: { contentType: string }) =>
          safe(async () => {
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192)
              binary += String.fromCharCode(...bytes.slice(i, i + 8192));
            return request(`/attachments/${encodeURIComponent(path.split('/').pop()!)}`, {
              method: 'PUT',
              body: JSON.stringify({
                name: path.split('/').pop(),
                mime: options.contentType,
                base64: btoa(binary),
              }),
            });
          }),
        download: (path: string) =>
          safe(() => request(`/attachments/${encodeURIComponent(path.split('/').pop()!)}`, {}, true)),
      }),
    },
    functions: {
      invoke: (_name: string, p: { body: unknown }) =>
        safe(() => request('/ai', { method: 'POST', body: JSON.stringify(p.body) })),
    },
  };
  // Compatibility boundary for the existing sync algorithm. Only the operations
  // implemented above are used; no Supabase service is involved in this adapter.
  return adapter as unknown as SupabaseClient;
}
export async function serverRequest(url: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (desktop) {
    const secret = await invoke<string | null>('server_session_get', { server: url.replace(/\/$/, '') });
    if (secret) headers.Authorization = `Bearer ${secret}`;
    headers['X-Notto-Client'] = 'desktop';
  }
  const response = await fetch(`${url.replace(/\/$/, '')}/api${path}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers,
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Serverfehler');
  return result;
}
