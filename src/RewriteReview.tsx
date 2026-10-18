import { useMemo } from 'react';
import { rewriteDiff } from './rewrite-diff';

export function RewriteReview({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => rewriteDiff(before, after), [before, after]);
  return (
    <section className="rewrite-review" aria-label="KI-Änderungen prüfen">
      <p className="rewrite-review-legend">
        Grün / +: neu oder geändert · Rot / −: entfernt. Erst „Festhalten“ speichert die neue Fassung.
      </p>
      <div className="rewrite-diff">
        {lines.map((line, index) => (
          <div key={index} className={`rewrite-line rewrite-line-${line.kind}`}>
            <span
              className="rewrite-line-marker"
              aria-label={
                line.kind === 'added' ? 'Hinzugefügt' : line.kind === 'removed' ? 'Entfernt' : undefined
              }
            >
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            <span>{line.text || '\u00a0'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
