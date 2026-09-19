import { useEffect, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@astryxdesign/core/Button';
import { Dialog } from '@astryxdesign/core/Dialog';
import { X, ImageOff } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';
import { fetchAttachment } from './cloud';
import { desktop } from './repository';
import { useNotto } from './state';

export function Action(props: ButtonProps) {
  return <Button size="lg" {...props} />;
}
export function Modal({
  title,
  children,
  onClose,
  width = 560,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <Dialog
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
  const { notify } = useNotto();
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => <NoteImage src={src} alt={alt} scope={scope} />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => {
                if (desktop) {
                  e.preventDefault();
                  void invoke('open_external', { url: href }).catch((e) => notify(String(e)));
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
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
