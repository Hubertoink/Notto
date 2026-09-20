import { NoteMarkdown } from './components';
import { ask, config, eligible, semanticSearch, type Evidence } from './intelligence';
import './search.css';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Search, Sparkles, X } from 'lucide-react';
import { matchesQuery, titleOf, excerptOf, type Note } from './domain';

export function FloatingSearch({
  open,
  onClose,
  onOpen,
  notes,
  scope,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  notes: Note[];
  scope: string;
  onSelect: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState<{ query: string; hits: (Evidence & { score: number })[] } | null>(
    null,
  );
  const [answer, setAnswer] = useState<{ text: string; sources: Evidence[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setError('');
    setSemantic(null);
    setAnswer(null);
  }, [query, open, scope]);
  const searchMeaning = async (question = false) => {
    if (!query.trim() || busy) return;
    const request = ++generation.current;
    const searched = query;
    setBusy(true);
    setError('');
    try {
      if (question) {
        const result = await ask(
          scope,
          searched,
          notes.filter((n) => n.scope === scope && !n.deleted),
        );
        if (request === generation.current)
          setAnswer({
            text: result.answer,
            sources: result.citations.map((c) => ({ ...result.sources[c.index], text: c.quote })),
          });
        return;
      }
      const hits = await semanticSearch(
        scope,
        searched,
        notes.filter((n) => n.scope === scope && !n.deleted),
      );
      if (request === generation.current) setSemantic({ query: searched, hits });
    } catch (error) {
      if (request === generation.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
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
  const direct = notes
    .filter((n) => n.scope === scope && !n.deleted && matchesQuery(n, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const related: Note[] = [];
  if (semantic?.query === query)
    for (const hit of semantic.hits) {
      const note = notes.find(
        (n) =>
          n.id === hit.noteId &&
          n.scope === scope &&
          n.revision === hit.revision &&
          !n.deleted &&
          eligible(n),
      );
      if (note && !direct.some((n) => n.id === note.id) && !related.some((n) => n.id === note.id))
        related.push(note);
    }
  const results = [...direct, ...related];
  const isQuestion = query.trim().endsWith('?') || query.trim().split(/\s+/).length >= 5;
  const aiEnabled = config(scope).enabled;
  const defaultAI = aiEnabled && query.trim() && (isQuestion || !results.length);
  const actionLabel = isQuestion ? 'Notizbuch fragen' : 'Sinngemäß suchen';
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
                placeholder="Notizen suchen oder eine Frage stellen …"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (defaultAI) {
                    void searchMeaning(isQuestion);
                    return;
                  }
                  if (results[0]) {
                    onSelect(results[0].id);
                    onClose();
                  }
                }}
              />
              <button aria-label="Suche schließen" onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            {query.trim() && (
              <div className="search-ai-controls">
                <button
                  onClick={() => void searchMeaning(isQuestion)}
                  disabled={busy || !config(scope).enabled}
                >
                  <Sparkles size={13} /> {busy ? 'Wird gesucht …' : actionLabel}
                </button>
                {!config(scope).enabled && <p>KI-Suche unter „Wissen & KI“ aktivieren.</p>}
                {error && <p role="alert">{error}</p>}
                {!busy && semantic?.query === query && (
                  <p role="status">
                    {related.length
                      ? `${related.length} zusätzliche KI-Treffer`
                      : 'Keine zusätzlichen KI-Treffer.'}
                  </p>
                )}
              </div>
            )}
            {answer && (
              <div className="search-answer">
                <NoteMarkdown content={answer.text} scope={scope} />
                {answer.sources
                  .filter((source) =>
                    notes.some(
                      (n) => n.id === source.noteId && n.scope === scope && !n.deleted && eligible(n),
                    ),
                  )
                  .map((source, i) => (
                    <button
                      key={i}
                      className="text-button"
                      onClick={() => {
                        onSelect(source.noteId);
                        onClose();
                      }}
                    >
                      {titleOf(notes.find((n) => n.id === source.noteId)?.content || 'Quelle')}
                      <blockquote>{source.text}</blockquote>
                    </button>
                  ))}
              </div>
            )}
            <div className="search-results" aria-busy={busy}>
              <p className="muted">{query ? `${results.length} Treffer` : 'Zuletzt bearbeitet'}</p>
              {[...direct.slice(0, 40), ...related].map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    onSelect(n.id);
                    onClose();
                  }}
                >
                  <strong>{titleOf(n.content)}</strong>
                  <span>{excerptOf(n.content)}</span>
                  {related.some((r) => r.id === n.id) && <small>Sinngemäßer KI-Treffer</small>}
                  {n.archived && <small>Archiv</small>}
                </button>
              ))}
              {!results.length && <p>Keine passenden Notizen.</p>}
            </div>
            <div className="search-footer">
              {defaultAI
                ? `Enter: ${actionLabel}`
                : results.length
                  ? 'Enter öffnet den ersten Treffer'
                  : 'Suchbegriff ändern'}{' '}
              · Esc schließt
            </div>
          </motion.div>
        )}
      </dialog>
    </>
  );
}
