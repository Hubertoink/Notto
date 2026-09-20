import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { X, ImageOff } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { invoke } from '@tauri-apps/api/core';
import { fetchAttachment } from './cloud';
import { desktop } from './repository';
import { useNotto } from './state';
import { PdfAttachment } from './PdfAttachment';
import { uniqueSources } from './knowledge-policy';
import { titleOf } from './domain';

export function NoteReferenceLink({
  id,
  scope,
  fallback,
}: {
  id: string;
  scope: string;
  fallback?: ReactNode;
}) {
  const { notes = [], notify } = useNotto();
  const note = notes.find((n) => n.id === id && n.scope === scope && !n.deleted);
  if (!note)
    return (
      <span className="note-reference missing" title="Notiz gelöscht oder nicht verfügbar">
        {fallback || 'Nicht verfügbare Notiz'}
      </span>
    );
  return (
    <a
      className="note-reference"
      href={`#note-${id}`}
      onClick={(e) => {
        e.preventDefault();
        if (desktop && new URLSearchParams(location.search).get('window') === 'widget') {
          void invoke('open_main', { noteId: id }).catch((e) => notify(String(e)));
        } else window.dispatchEvent(new CustomEvent('notto-open-note', { detail: { id, scope } }));
      }}
    >
      ↗ {titleOf(note.content)}
    </a>
  );
}

export function WebLink({ href, children }: { href?: string; children: ReactNode }) {
  const { notify } = useNotto();
  if (!href || !uniqueSources([{ url: href, title: '' }]).length) return <span>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        if (desktop) {
          e.preventDefault();
          void invoke('open_external', { url: href }).catch((error) => notify(String(error)));
        }
      }}
    >
      {children}
    </a>
  );
}
export function Sources({ sources }: { sources: { title: string; url: string }[] }) {
  return (
    <ul className="research-sources">
      {uniqueSources(sources).map((source) => (
        <li key={source.url}>
          <WebLink href={source.url}>{source.title}</WebLink>
        </li>
      ))}
    </ul>
  );
}

export function Action(props: ButtonProps) {
  return <Button size="lg" {...props} className={`notto-action ${props.className || ''}`} />;
}
export function Modal({
  title,
  children,
  onClose,
  width = 560,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
  className?: string;
}) {
  return (
    <Dialog
      className={className}
      isOpen
      onOpenChange={(open) => !open && onClose()}
      purpose="form"
      width={width}
      maxHeight="88dvh"
      padding={0}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <Action label="Schließen" isIconOnly icon={<X size={18} />} variant="ghost" onClick={onClose} />
      </div>
      <div className="modal-body">{children}</div>
    </Dialog>
  );
}
function NoteImage({ src, alt, scope }: { src?: string; alt?: string; scope: string }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setFailed(false);
    const id = src?.match(/^attachments\/([a-f0-9-]+\.(?:png|jpg|webp|gif|avif))$/)?.[1];
    if (!id) {
      setFailed(true);
      return;
    }
    fetchAttachment(scope, id)
      .then((a) => {
        if (!a) throw new Error('Bild fehlt');
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(a.bytes)], { type: a.mime }));
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, scope]);
  if (failed)
    return (
      <span className="image-fallback">
        <ImageOff size={18} /> {alt || 'Bild'} – nicht verfügbar
      </span>
    );
  return url ? (
    <img src={url} alt={alt || 'Bild in der Notiz'} loading="lazy" />
  ) : (
    <span className="image-fallback">Bild wird geladen …</span>
  );
}
export function NoteMarkdown({ content, scope }: { content: string; scope: string }) {
  // Stable component types keep loaded attachments mounted during save/status updates.
  const components = useMemo<Components>(
    () => ({
      table: ({ children }) => (
        <div
          className="markdown-table-scroll"
          role="region"
          aria-label="Tabelle, horizontal scrollbar"
          tabIndex={0}
        >
          <table>{children}</table>
        </div>
      ),
      img: ({ src, alt }) => <NoteImage src={src} alt={alt} scope={scope} />,
      a: ({ href, children }) =>
        /^notes\/[a-f0-9-]{36}$/.test(href || '') ? (
          <NoteReferenceLink scope={scope} id={href!.slice(6)} fallback={children} />
        ) : /^attachments\/[a-f0-9-]+\.pdf$/.test(href || '') ? (
          <PdfAttachment scope={scope} id={href!.slice(12)}>
            {children}
          </PdfAttachment>
        ) : (
          <WebLink href={href}>{children}</WebLink>
        ),
    }),
    [scope],
  );
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
export function readableDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
