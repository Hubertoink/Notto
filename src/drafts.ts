import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { desktop, repo } from './repository';
import type { Draft } from './domain';

export function useNewDrafts(scope: string) {
  const [state, setState] = useState<{ scope: string; drafts: Draft[] }>({ scope, drafts: [] });
  useEffect(() => {
    let closed = false;
    let sequence = 0;
    let dispose: (() => void) | undefined;
    const load = async () => {
      const current = ++sequence;
      const drafts = await repo.drafts(scope);
      if (!closed && current === sequence)
        setState({
          scope,
          drafts: drafts
            .filter((d) => (d.noteId === null || d.noteId === 'widget') && d.content.trim())
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        });
    };
    const reload = () => {
      void load().catch(console.error);
    };
    reload();
    window.addEventListener('notto-drafts', reload);
    if (desktop) void listen('notto-drafts', reload).then((fn) => (closed ? fn() : (dispose = fn)));
    return () => {
      closed = true;
      dispose?.();
      window.removeEventListener('notto-drafts', reload);
    };
  }, [scope]);
  return state.scope === scope ? state.drafts : [];
}
