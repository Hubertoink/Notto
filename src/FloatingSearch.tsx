import './search.css';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Search, X } from 'lucide-react';
import { matchesQuery, titleOf, excerptOf, type Note } from './domain';

export function FloatingSearch({
  open,
  onClose,
  onOpen,
  notes,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  notes: Note[];
  onSelect: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const reduced = useReducedMotion();
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      field.current?.focus();
    } else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [open]);
  const results = notes
    .filter((n) => !n.deleted && matchesQuery(n, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      {!open && (
        <motion.button
          ref={trigger}

          className="floating-search-trigger"
          onClick={onOpen}
          aria-label="Notizen durchsuchen (Strg K)"
        >
          <Search size={18} />
          <kbd>Strg K</kbd>
        </motion.button>
      )}
      <dialog
        ref={dialog}
        className="search-dialog"
        aria-label="Notizen durchsuchen"
        onCancel={(e) => {
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {open && (
          <motion.div
            className="search-surface"
            initial={reduced ? false : { opacity: 0, width: 130, height: 48, borderRadius: 28 }}
            animate={{ opacity: 1, width: '100%', height: 'auto', borderRadius: 18 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 32 }}
          >
            <div className="search-field">
              <Search size={20} />
              <input
                ref={field}
                aria-label="Suchbegriff"
                placeholder="Notizen, Wörter oder #tags suchen …"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results[0]) {
                    onSelect(results[0].id);
                    onClose();
                  }
                }}
              />
              <button aria-label="Suche schließen" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            <div className="search-results">
              <p className="muted">{query ? `${results.length} Treffer` : 'Zuletzt bearbeitet'}</p>
              {results.slice(0, 50).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    onSelect(n.id);
                    onClose();
                  }}
                >
                  <strong>{titleOf(n.content)}</strong>
                  <span>{excerptOf(n.content)}</span>
                  {n.archived && <small>Archiv</small>}
                </button>
              ))}
              {!results.length && <p>Keine passenden Notizen.</p>}
            </div>
            <div className="search-footer">Enter öffnet den ersten Treffer · Esc schließt</div>
          </motion.div>
        )}
      </dialog>
    </>
  );
}
