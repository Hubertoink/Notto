import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { X, ImageOff, Globe, ChevronDown, Download, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { save } from '@tauri-apps/plugin-dialog';
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
      ↗ {fallback || titleOf(note.content)}
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
function useImageAttachment(src: string | undefined, scope: string) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [attachment, setAttachment] = useState<Awaited<ReturnType<typeof fetchAttachment>>>();
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setFailed(false);
    setAttachment(undefined);
    const id = src?.match(/^attachments\/([a-f0-9-]+\.(?:png|jpg|webp|gif|avif))$/)?.[1];
    if (!id) {
      setFailed(true);
      return;
    }
    fetchAttachment(scope, id)
      .then((a) => {
        if (!a) throw new Error('Bild fehlt');
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(a.bytes)], { type: a.mime }));
        if (active) {
          setUrl(objectUrl);
          setAttachment(a);
        } else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, scope]);
  return { url, failed, attachment };
}
export function NoteImage({ src, alt, scope }: { src?: string; alt?: string; scope: string }) {
  const { url, failed } = useImageAttachment(src, scope);
  if (failed)
    return (
      <span className="image-fallback">
        <ImageOff size={18} /> {alt || 'Bild'} – nicht verfügbar
      </span>
    );
  return url ? (
    <img
      src={url}
      alt={alt || 'Bild in der Notiz'}
      loading="lazy"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    />
  ) : (
    <span className="image-fallback">Bild wird geladen …</span>
  );
}
export function ImageLightbox({
  src,
  alt,
  scope,
  onClose,
}: {
  src?: string;
  alt?: string;
  scope: string;
  onClose: () => void;
}) {
  const { url, failed, attachment } = useImageAttachment(src, scope);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    el.showModal();
    el.focus();
    return () => {
      el.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  async function download() {
    if (!attachment || !url) return;
    try {
      if (desktop) {
        const path = await save({ defaultPath: attachment.name || alt || 'Bild.png' });
        if (path) await invoke('write_export', { path, bytes: Array.from(attachment.bytes) });
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.name || alt || 'Bild.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch {
      setError('Das Bild konnte nicht gespeichert werden. Bitte erneut versuchen.');
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="image-lightbox"
      tabIndex={-1}
      aria-label={alt || 'Bildansicht'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lightbox-surface">
        {url ? (
          <img src={url} alt={alt || 'Bild'} draggable={false} />
        ) : (
          <p>{failed ? 'Bild nicht verfügbar' : 'Bild wird geladen …'}</p>
        )}
        <button type="button" className="lightbox-close" aria-label="Bild schließen" onClick={onClose}>
          <X size={22} />
        </button>
        <button type="button" className="lightbox-download" disabled={!url} onClick={() => void download()}>
          <Download size={18} /> Herunterladen
        </button>
        {error && (
          <p role="alert" className="lightbox-error">
            {error}
          </p>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
export function InlineImage({
  content,
  scope,
  image,
  onChange,
  disabled,
}: {
  content: string;
  scope: string;
  image: ReturnType<typeof noteImages>[number];
  onChange: (content: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; container: number } | null>(null);
  const width = dragWidth ?? image.width;
  const remove = () => {
    if (!disabled) onChange(content.slice(0, image.start) + content.slice(image.start + image.raw.length));
  };
  return (
    <div
      ref={host}
      className="inline-image-block"
      style={{ width: image.thumbnail ? '120px' : `calc(${width}% - ${(1 - width / 100) * 12}px)` }}
      onDragStart={(e) => e.preventDefault()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setSelected(false);
      }}
    >
      <div
        className={`inline-image-frame ${selected ? 'selected' : ''} ${image.thumbnail ? 'is-thumbnail' : ''}`}
      >
        <button
          type="button"
          className="inline-image-select"
          disabled={disabled}
          aria-label={`${image.alt || 'Bild'} bearbeiten`}
          onClick={() => setSelected(!selected)}
          onKeyDown={(e) => {
            if (selected && ['Delete', 'Backspace'].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              remove();
            }
          }}
        >
          <NoteImage src={image.src} alt={image.alt} scope={scope} />
        </button>
        {selected && (
          <>
            <div className="inline-image-options">
              <label>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={image.thumbnail}
                  onChange={(e) =>
                    onChange(updateImageLayout(content, image.start, image.width, e.target.checked))
                  }
                />{' '}
                Als Thumbnail
              </label>
              <button
                type="button"
                aria-label="Bild aus Notiz entfernen"
                title="Bild aus Notiz entfernen"
                disabled={disabled}
                onClick={remove}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {!image.thumbnail && (
              <button
                type="button"
                className="image-resize-handle"
                aria-label="Bildgröße ändern"
                disabled={disabled}
                onPointerDown={(e) => {
                  if (disabled || image.thumbnail || e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = {
                    x: e.clientX,
                    width: image.width,
                    container: host.current?.parentElement?.clientWidth || 1,
                  };
                }}
                onPointerMove={(e) => {
                  if (drag.current)
                    setDragWidth(
                      Math.round(
                        Math.max(
                          20,
                          Math.min(
                            100,
                            drag.current.width +
                              ((e.clientX - drag.current.x) / drag.current.container) * 100,
                          ),
                        ),
                      ),
                    );
                }}
                onPointerUp={(e) => {
                  if (!drag.current) return;
                  const next = Math.round(
                    Math.max(
                      20,
                      Math.min(
                        100,
                        drag.current.width + ((e.clientX - drag.current.x) / drag.current.container) * 100,
                      ),
                    ),
                  );
                  drag.current = null;
                  setDragWidth(null);
                  onChange(updateImageLayout(content, image.start, next, false));
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragWidth(null);
                }}
                onKeyDown={(e) => {
                  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault();
                    onChange(
                      updateImageLayout(
                        content,
                        image.start,
                        image.width + (e.key === 'ArrowRight' ? 5 : -5),
                        false,
                      ),
                    );
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ImageGallery({ content, scope }: { content: string; scope: string }) {
  const images = noteImages(content).filter((image) => image.thumbnail);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [columns, setColumns] = useState(3);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor(el.clientWidth / 145)));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    const close = (e: PointerEvent) => {
      if (!el.contains(e.target as Node) && selected === null) setExpanded(false);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', close);
    };
  }, [images.length, selected]);
  if (!images.length) return null;
  return (
    <div
      ref={host}
      className={`image-fan ${expanded ? 'expanded' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setExpanded(false);
      }}
    >
      <div className="image-fan-cards">
        {images.map((image, i) => (
          <button
            type="button"
            key={`${image.src}-${i}`}
            className="image-fan-card"
            aria-label={expanded ? `${image.alt || `Bild ${i + 1}`} vergrößern` : 'Bilder auffächern'}
            aria-expanded={expanded}
            tabIndex={expanded || i === 0 ? 0 : -1}
            style={{
              width: expanded ? `calc(${100 / columns}% - 10px)` : '70px',
              height: expanded ? '130px' : '80px',
              left: expanded ? `${((i % columns) * 100) / columns}%` : `${Math.min(i, 3) * 24}px`,
              transform: expanded
                ? `translateY(${Math.floor(i / columns) * 142}px) rotate(${i % 2 ? 2 : -2}deg)`
                : `rotate(${Math.min(i, 3) * 7 - 10}deg)`,
              opacity: expanded || i < 4 ? 1 : 0,
              pointerEvents: expanded || i < 4 ? 'auto' : 'none',
              zIndex: i + 1,
            }}
            onClick={() => (expanded ? setSelected(i) : setExpanded(true))}
          >
            <NoteImage src={image.src} alt={image.alt} scope={scope} />
          </button>
        ))}
      </div>
      {expanded && (
        <button
          type="button"
          className="image-fan-close"
          aria-label="Bilder einklappen"
          onClick={() => setExpanded(false)}
        >
          <X size={16} />
        </button>
      )}
      {selected !== null && images[selected] && (
        <ImageLightbox
          src={images[selected].src}
          alt={images[selected].alt}
          scope={scope}
          onClose={() => setSelected(null)}
        />
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
        style={{ width: `calc(${layout.width}% - ${(1 - layout.width / 100) * 12}px)` }}
        aria-label={`${alt || 'Bild'} vergrößern`}
        onClick={() => setOpen(true)}
      >
        <NoteImage src={src} alt={alt} scope={scope} />
      </button>
      {open && <ImageLightbox src={src} alt={alt} scope={scope} onClose={() => setOpen(false)} />}
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
    const inline = noteImages(result);
    for (let i = inline.length - 1; i > 0; i--) {
      const end = inline[i - 1].start + inline[i - 1].raw.length;
      if (!result.slice(end, inline[i].start).trim())
        result = result.slice(0, end) + ' ' + result.slice(inline[i].start);
    }
    return result.replace(
      /(```|~~~)[\s\S]*?\1|^[ \t]*(?:#[\p{L}\p{N}][\p{L}\p{N}_/-]*[ \t]*)+$/gmu,
      (match) => (match.startsWith('```') || match.startsWith('~~~') ? match : ''),
    );
  }, [content]);
  // Stable component types keep loaded attachments mounted during save/status updates.
  const components = useMemo<Components>(
    () => ({
      p: ({ node, children }) =>
        node?.children.some((child) => child.type === 'element' && child.tagName === 'img') &&
        node.children.every((child) =>
          child.type === 'element' ? child.tagName === 'img' : child.type === 'text' && !child.value.trim(),
        ) ? (
          <div className="reading-image-row">{children}</div>
        ) : (
          <p>{children}</p>
        ),
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
