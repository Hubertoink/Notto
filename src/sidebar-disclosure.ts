import { useState } from 'react';

const storageKey = 'notto-sidebar-disclosures';
export function useSidebarDisclosure(scope: string) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
      return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean'));
    } catch {
      return {};
    }
  });
  const keyFor = (name: string) => JSON.stringify([scope, name]);
  const isExpanded = (name: string, fallback = false) => expanded[keyFor(name)] ?? fallback;
  const toggle = (name: string, fallback = false) => {
    setExpanded((previous) => {
      const key = keyFor(name);
      const next = { ...previous, [key]: !(previous[key] ?? fallback) };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* Keep controls usable without storage. */
      }
      return next;
    });
  };
  return [isExpanded, toggle] as const;
}
