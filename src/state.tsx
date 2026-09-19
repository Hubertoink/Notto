import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { User } from '@supabase/supabase-js';
import { cloud, syncNotes } from './cloud';
import { desktop, repo } from './repository';
import type { Note } from './domain';

function useStore() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [syncState, setSyncState] = useState<'local' | 'offline' | 'syncing' | 'synced' | 'error'>('local');
  const [syncError, setSyncError] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const scope = user?.id ?? 'local';
  const currentScope = useRef(scope);
  const reloadSequence = useRef(0);
  currentScope.current = scope;
  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  const reload = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    try {
      const found = await repo.list(scope);
      if (currentScope.current === scope && sequence === reloadSequence.current) {
        setNotes(found);
        setLoading(false);
      }
    } catch (e) {
      notify(String(e));
      setLoading(false);
    }
  }, [scope, notify]);
  useEffect(() => {
    const c = cloud();
    if (!c) {
      setAuthReady(true);
      return;
    }
    let active = true;
    c.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) notify(error.message);
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data } = c.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [notify]);
  useEffect(() => {
    setNotes([]);
    setLoading(true);
    void reload();
    window.addEventListener('notto-change', reload);
    let dispose: (() => void) | undefined;
    let closed = false;
    if (desktop) listen('notto-change', reload).then((fn) => (closed ? fn() : (dispose = fn)));
    return () => {
      closed = true;
      dispose?.();
      window.removeEventListener('notto-change', reload);
    };
  }, [reload]);
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let closed = false;
    listen<string>('storage-warning', (e) => notify(e.payload)).then((fn) =>
      closed ? fn() : (dispose = fn),
    );
    return () => {
      closed = true;
      dispose?.();
    };
  }, [notify]);
  const sync = useCallback(async () => {
    if (scope === 'local') {
      setSyncState('local');
      return;
    }
    if (!navigator.onLine) {
      setSyncState('offline');
      return;
    }
    setSyncState('syncing');
    try {
      const conflicts = await syncNotes(scope);
      if (scope !== currentScope.current) return;
      setSyncState('synced');
      setSyncError('');
      setLastSync(new Date().toISOString());
      await reload();
      if (conflicts) notify(`${conflicts} Konfliktkopie(n) angelegt. Beide Fassungen sind erhalten.`);
    } catch (e) {
      if (scope !== currentScope.current) return;
      setSyncState('error');
      setSyncError(e instanceof Error ? e.message : String(e));
    }
  }, [scope, reload, notify]);
  useEffect(() => {
    if (!authReady) return;
    void sync();
    const timer = setInterval(() => void sync(), 30000);
    const online = () => void sync();
    const offline = () => setSyncState(scope === 'local' ? 'local' : 'offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [sync, scope, authReady]);
  const dirty = notes
    .filter((n) => n.dirty)
    .map((n) => n.revision)
    .join(',');
  useEffect(() => {
    if (scope === 'local' || !dirty) return;
    const timer = setTimeout(() => void sync(), 1800);
    return () => clearTimeout(timer);
  }, [dirty, scope, sync]);
  return {
    user,
    scope,
    notes,
    loading: loading || !authReady,
    notify,
    notice,
    sync,
    syncState,
    syncError,
    lastSync,
    reload,
  };
}
const Context = createContext<ReturnType<typeof useStore> | null>(null);
export function NottoProvider({ children }: { children: ReactNode }) {
  const state = useStore();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useNotto() {
  const state = useContext(Context);
  if (!state) throw new Error('Notto provider missing');
  return state;
}
