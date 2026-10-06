import { useState } from 'react';
import { type CommandCitation } from './note-command';
import { PdfAttachment } from './PdfAttachment';
import { DocumentAttachment } from './DocumentAttachment';

export function CitationLink({ citation, scope }: { citation: CommandCitation; scope: string }) {
  const [showQuote, setShowQuote] = useState(false);
  const label = `${citation.title}${citation.page ? `, Seite ${citation.page}` : ''}`;
  return (
    <span className="document-citation">
      {citation.attachment?.endsWith('.pdf') ? (
        <PdfAttachment scope={scope} id={citation.attachment} initialPage={citation.page}>
          {label}
        </PdfAttachment>
      ) : citation.attachment && /\.(docx|txt|md)$/.test(citation.attachment) ? (
        <DocumentAttachment scope={scope} id={citation.attachment}>
          {label}
        </DocumentAttachment>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('notto-open-note', { detail: { id: citation.noteId, scope } }),
            )
          }
        >
          {label}
        </button>
      )}
      {citation.quote && (
        <>
          <button
            type="button"
            className="text-button"
            aria-expanded={showQuote}
            onClick={() => setShowQuote(!showQuote)}
          >
            Beleg {showQuote ? 'ausblenden' : 'zeigen'}
          </button>
          {showQuote && <blockquote>{citation.quote}</blockquote>}
        </>
      )}
    </span>
  );
}
