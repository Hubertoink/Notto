import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { X, ImageOff, Globe, ChevronDown } from 'lucide-react';
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
import { imageLayout, noteImages, updateImageLayout } from './image-layout';

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
function SourceIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="source-circle" aria-hidden="true">
      {failed ? (
        <Globe size={18} />
      ) : (
        <img
          src={`${new URL(url).origin}/favicon.ico`}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
export function Sources({
  sources,
  compact = false,
}: {
  sources: { title: string; url: string }[];
  compact?: boolean;
}) {
  const unique = uniqueSources(sources);
  if (!unique.length) return null;
  if (compact)
    return (
      <details className="source-disclosure">
        <summary aria-label={`${unique.length} ${unique.length === 1 ? 'Quelle' : 'Quellen'} anzeigen`}>
          <span className="source-circles">
            <SourceIcon url={unique[0].url} />
            {unique.length > 1 && <span className="source-circle source-more">+{unique.length - 1}</span>}
          </span>
          <span>{unique.length === 1 ? 'Quelle' : 'Quellen'}</span>
          <ChevronDown size={14} className="source-chevron" />
        </summary>
        <ul className="source-cards">
          {unique.map((source) => (
            <li key={source.url}>
              <SourceIcon url={source.url} />
              <div>
                <WebLink href={source.url}>{source.title || new URL(source.url).hostname}</WebLink>
                <span className="source-domain">{new URL(source.url).hostname.replace(/^www\./, '')}</span>
                <span className="source-url">{source.url}</span>
              </div>
            </li>
          ))}
        </ul>
      </details>
    );
  return (
    <ul className="research-sources">
      {unique.map((source) => (
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
export function NoteImage({ src, alt, scope }: { src?: string; alt?: string; scope: string }) {
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
export function ImageEditor({
  content,
  scope,
  onChange,
  disabled,
}: {
  content: string;
  scope: string;
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const images = noteImages(content);
  if (!images.length) return null;
  return (
    <details className="image-editor" open>
      <summary>Bilder · {images.length}</summary>
      <div className="image-editor-grid">
        {images.map((image, index) => (
          <fieldset key={`${image.src}-${index}`} disabled={disabled} className="image-editor-card">
            <legend>{image.alt || `Bild ${index + 1}`}</legend>
            <div className="image-editor-preview">
              <div style={{ width: `${image.width}%` }}>
                <NoteImage src={image.src} alt={image.alt} scope={scope} />
              </div>
            </div>
            <label>
              Breite <output>{image.width}%</output>
              <input
                aria-label={`Breite Bild ${index + 1}`}
                type="range"
                min="20"
                max="100"
                step="5"
                value={image.width}
                disabled={image.thumbnail}
                onChange={(e) =>
                  onChange(updateImageLayout(content, image.start, Number(e.target.value), image.thumbnail))
                }
              />
            </label>
            <label className="image-mode">
              <input
                type="checkbox"
                checked={image.thumbnail}
                onChange={(e) =>
                  onChange(updateImageLayout(content, image.start, image.width, e.target.checked))
                }
              />{' '}
              Als Thumbnail oben
            </label>
            <button
              type="button"
              className="image-remove"
              onClick={() =>
                onChange(content.slice(0, image.start) + content.slice(image.start + image.raw.length))
              }
            >
              Aus Notiz entfernen
            </button>
          </fieldset>
        ))}
      </div>
    </details>
  );
}

function ImageGallery({ content, scope }: { content: string; scope: string }) {
  const images = noteImages(content).filter((image) => image.thumbnail);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  if (!images.length) return null;
  return (
    <div className="image-gallery">
      <button
        type="button"
        className="image-gallery-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {!expanded && (
          <span className="image-stack" aria-hidden="true">
            {images.slice(0, 3).map((image, i) => (
              <span key={i}>
                <NoteImage src={image.src} alt="" scope={scope} />
              </span>
            ))}
          </span>
        )}
        <span>
          {images.length} {images.length === 1 ? 'Bild' : 'Bilder'} · {expanded ? 'Einklappen' : 'Anzeigen'}
        </span>
        <ChevronDown size={16} />
      </button>
      {expanded && (
        <div className="image-gallery-grid">
          {images.map((image, i) => (
            <button
              type="button"
              key={`${image.src}-${i}`}
              aria-label={`${image.alt || `Bild ${i + 1}`} vergrößern`}
              onClick={() => setSelected(i)}
            >
              <NoteImage src={image.src} alt={image.alt} scope={scope} />
            </button>
          ))}
        </div>
      )}
      {selected !== null && images[selected] && (
        <Modal
          title={images[selected].alt || 'Bild'}
          width={1000}
          className="image-lightbox"
          onClose={() => setSelected(null)}
        >
          <NoteImage src={images[selected].src} alt={images[selected].alt} scope={scope} />
        </Modal>
      )}
    </div>
  );
}

function MarkdownImage({
  src,
  alt,
  title,
  scope,
}: {
  src?: string;
  alt?: string;
  title?: string;
  scope: string;
}) {
  const layout = imageLayout(title);
  const [open, setOpen] = useState(false);
  if (layout.thumbnail) return null;
  return (
    <>
      <button
        type="button"
        className="note-image-button"
        style={{ width: `${layout.width}%` }}
        aria-label={`${alt || 'Bild'} vergrößern`}
        onClick={() => setOpen(true)}
      >
        <NoteImage src={src} alt={alt} scope={scope} />
      </button>
      {open && (
        <Modal title={alt || 'Bild'} width={1000} className="image-lightbox" onClose={() => setOpen(false)}>
          <NoteImage src={src} alt={alt} scope={scope} />
        </Modal>
      )}
    </>
  );
}
export function NoteMarkdown({ content, scope }: { content: string; scope: string }) {
  const readingContent = useMemo(() => {
    let result = content;
    for (const image of noteImages(content)
      .filter((image) => image.thumbnail)
      .reverse()) {
      result = result.slice(0, image.start) + result.slice(image.start + image.raw.length);
    }
    return result;
  }, [content]);
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
      img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} scope={scope} />,
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
      <ImageGallery content={content} scope={scope} />
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {readingContent}
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
